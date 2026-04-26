package provisioner

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/ssh"
)

// Service executes provisioning scripts on servers over SSH.
type Service struct {
	queries   *db.Queries
	redis     *redis.Client
	logger    *slog.Logger
	masterKey [32]byte
	apiURL    string
	grpcAddr  string
}

// NewService creates a new provisioning service.
func NewService(queries *db.Queries, redisClient *redis.Client, logger *slog.Logger, masterKey [32]byte, apiURL string, grpcAddr string) *Service {
	return &Service{
		queries:   queries,
		redis:     redisClient,
		logger:    logger,
		masterKey: masterKey,
		apiURL:    apiURL,
		grpcAddr:  grpcAddr,
	}
}

// filePaths returns candidate paths for a dotfile at the project root.
func filePaths(name string) []string {
	paths := []string{name, "../../" + name, "../" + name}
	if root := os.Getenv("NIXWAY_ROOT"); root != "" {
		paths = append([]string{root + "/" + name}, paths...)
	}
	return paths
}

// readDotfile reads the first found dotfile from candidate paths.
func readDotfile(name string) string {
	for _, path := range filePaths(name) {
		if data, err := os.ReadFile(path); err == nil {
			if v := strings.TrimSpace(string(data)); v != "" {
				return v
			}
		}
	}
	return ""
}

// resolvePublicURL returns the current public URL, always re-reading .tunnel-url
// since free Cloudflare tunnels rotate URLs frequently.
func (s *Service) resolvePublicURL() string {
	if url := readDotfile(".tunnel-url"); url != "" {
		if url != s.apiURL {
			s.logger.Info("tunnel URL updated for provisioning", "old", s.apiURL, "new", url)
		}
		s.apiURL = url
		return url
	}
	return s.apiURL
}

// resolveGRPCAddr returns the gRPC address the agent should connect to.
// In dev, agents use localhost:9090 via SSH reverse tunnel from the controller.
func (s *Service) resolveGRPCAddr() string {
	return "localhost:9090"
}

// stripScheme removes the http:// or https:// prefix from a URL.
func stripScheme(rawURL string) string {
	for _, prefix := range []string{"https://", "http://"} {
		if len(rawURL) > len(prefix) && rawURL[:len(prefix)] == prefix {
			return rawURL[len(prefix):]
		}
	}
	return rawURL
}

// RunProvisioning SSHes into the server and executes each component script,
// streaming output to Redis pub/sub and persisting logs in the database.
func (s *Service) RunProvisioning(ctx context.Context, jobID, serverID, teamID uuid.UUID, components []string) {
	// 1. Get server details.
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		s.logger.Error("failed to get server", "server_id", serverID, "error", err)
		s.failJob(ctx, jobID, fmt.Sprintf("get server: %v", err))
		return
	}

	// 2. Get SSH key for this server and decrypt it.
	sshKey, err := s.queries.GetSSHKeyForServer(ctx, serverID)
	if err != nil {
		s.logger.Error("failed to get ssh key for server", "server_id", serverID, "error", err)
		s.failJob(ctx, jobID, fmt.Sprintf("get ssh key: %v", err))
		return
	}

	privateKey, err := crypto.Decrypt(sshKey.PrivateKeyEncrypted, s.masterKey, "ssh-private-key")
	if err != nil {
		s.logger.Error("failed to decrypt ssh key", "server_id", serverID, "error", err)
		s.failJob(ctx, jobID, fmt.Sprintf("decrypt ssh key: %v", err))
		return
	}

	// 3. Create SSH client.
	client, err := ssh.NewClient(srv.Hostname, int(srv.SshPort), srv.SshUser, privateKey)
	if err != nil {
		s.logger.Error("failed to create ssh client", "server_id", serverID, "error", err)
		s.failJob(ctx, jobID, fmt.Sprintf("ssh client: %v", err))
		return
	}

	// 4. Update job status to running.
	now := time.Now()
	if err := s.queries.UpdateProvisioningJobStatus(ctx, db.UpdateProvisioningJobStatusParams{
		ID:        jobID,
		Status:    "running",
		StartedAt: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		s.logger.Error("failed to update job status", "job_id", jobID, "error", err)
		return
	}

	channel := "provision:" + jobID.String()

	// 5. Always install agent as the last step.
	hasAgent := false
	for _, c := range components {
		if c == "agent" {
			hasAgent = true
			break
		}
	}
	if !hasAgent {
		components = append(components, "agent")
	}

	// 6. Execute each component script.
	for _, component := range components {
		var script []byte
		if component == "agent" {
			script, err = GetAgentScript(s.resolvePublicURL(), s.resolveGRPCAddr(), serverID.String())
		} else {
			script, err = GetScript(component)
		}
		if err != nil {
			s.logger.Error("failed to get script", "component", component, "error", err)
			s.failJob(ctx, jobID, fmt.Sprintf("script not found for %s: %v", component, err))
			return
		}

		if component == "agent" {
			if err := s.pushAgentBinary(ctx, client, srv.Arch); err != nil {
				s.publishLine(ctx, channel, fmt.Sprintf("WARN: unable to upload agent binary over SSH, falling back to tunnel download: %v", err))
			} else {
				s.publishLine(ctx, channel, ">>> Uploaded agent binary over SSH")
			}
		}

		remotePath := fmt.Sprintf("/tmp/nixway-provision-%s.sh", component)
		if err := client.PushFile(ctx, script, remotePath, "0755"); err != nil {
			s.logger.Error("failed to push script", "component", component, "error", err)
			s.failJob(ctx, jobID, fmt.Sprintf("push script for %s: %v", component, err))
			return
		}

		s.publishLine(ctx, channel, fmt.Sprintf(">>> Starting component: %s", component))

		execErr := client.RunCommandStreaming(ctx, "sudo bash "+remotePath, func(line string) {
			s.publishLine(ctx, channel, line)
			// Append to job logs in DB (best-effort).
			_ = s.queries.AppendProvisioningLog(ctx, db.AppendProvisioningLogParams{
				ID:   jobID,
				Logs: line + "\n",
			})
		})
		if execErr != nil {
			errMsg := fmt.Sprintf("component %s failed: %v", component, execErr)
			s.publishLine(ctx, channel, "ERROR: "+errMsg)
			s.failJob(ctx, jobID, errMsg)
			return
		}

		s.publishLine(ctx, channel, fmt.Sprintf(">>> Completed component: %s", component))
		s.logger.Info("component provisioned", "job_id", jobID, "component", component)
	}

	// 6. Mark job as completed.
	s.publishLine(ctx, channel, ">>> Provisioning completed successfully")
	_ = s.queries.UpdateProvisioningJobStatus(ctx, db.UpdateProvisioningJobStatusParams{
		ID:          jobID,
		Status:      "completed",
		CompletedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
}

func (s *Service) publishLine(ctx context.Context, channel, line string) {
	if err := s.redis.Publish(ctx, channel, line).Err(); err != nil {
		s.logger.Warn("failed to publish provision log line", "channel", channel, "error", err)
	}
}

func (s *Service) pushAgentBinary(ctx context.Context, client *ssh.Client, serverArch *string) error {
	arch := normalizeAgentArch("")
	if serverArch != nil {
		arch = normalizeAgentArch(*serverArch)
	}
	if arch == "" {
		out, err := client.RunCommand(ctx, "uname -m")
		if err != nil {
			return fmt.Errorf("detect remote arch: %w", err)
		}
		arch = normalizeAgentArch(out)
	}
	if arch == "" {
		return fmt.Errorf("unsupported remote architecture")
	}

	path, err := findAgentBinary(arch)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read agent binary: %w", err)
	}
	if len(data) == 0 {
		return fmt.Errorf("agent binary is empty: %s", path)
	}
	return client.PushFile(ctx, data, "/tmp/nixway-agent-uploaded", "0755")
}

func normalizeAgentArch(raw string) string {
	switch strings.TrimSpace(raw) {
	case "amd64", "x86_64":
		return "amd64"
	case "arm64", "aarch64":
		return "arm64"
	default:
		return ""
	}
}

func findAgentBinary(arch string) (string, error) {
	name := filepath.Join("apps", "agent", "bin", "agent-linux-"+arch)
	for _, path := range filePaths(name) {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path, nil
		}
	}
	return "", fmt.Errorf("agent binary not found for %s; build apps/agent/bin/agent-linux-%s", arch, arch)
}

func (s *Service) failJob(ctx context.Context, jobID uuid.UUID, errMsg string) {
	_ = s.queries.UpdateProvisioningJobStatus(ctx, db.UpdateProvisioningJobStatusParams{
		ID:          jobID,
		Status:      "failed",
		CompletedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Error:       &errMsg,
	})
}
