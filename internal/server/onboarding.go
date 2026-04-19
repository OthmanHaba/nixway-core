package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/provisioner"
	"github.com/othmanhaba/nixway-core/internal/ssh"
)

// OnboardRequest contains the parameters for onboarding a new server.
type OnboardRequest struct {
	TeamID   uuid.UUID
	Name     string
	Hostname string
	PublicIP string
	SSHPort  int32
	SSHUser  string
	SSHKeyID uuid.UUID
}

// OnboardResult contains the result of a successful onboarding.
type OnboardResult struct {
	Server db.Server
}

// OnboardingService handles the full server onboarding flow.
type OnboardingService struct {
	queries   *db.Queries
	logger    *slog.Logger
	masterKey [32]byte
	apiURL    string
}

func NewOnboardingService(queries *db.Queries, logger *slog.Logger, masterKey [32]byte, apiURL string) *OnboardingService {
	return &OnboardingService{
		queries:   queries,
		logger:    logger,
		masterKey: masterKey,
		apiURL:    apiURL,
	}
}

// supportedOS lists accepted OS/version combinations.
var supportedOS = map[string][]string{
	"ubuntu": {"22.04", "24.04"},
	"debian": {"12"},
}

func isSupportedOS(osName, version string) bool {
	versions, ok := supportedOS[strings.ToLower(osName)]
	if !ok {
		return false
	}
	for _, v := range versions {
		if v == version {
			return true
		}
	}
	return false
}

// Onboard runs the full server add flow.
func (s *OnboardingService) Onboard(ctx context.Context, req OnboardRequest) (*OnboardResult, error) {
	// 1. Get + decrypt SSH key
	sshKey, err := s.queries.GetSSHKeyByID(ctx, db.GetSSHKeyByIDParams{
		ID:     req.SSHKeyID,
		TeamID: req.TeamID,
	})
	if err != nil {
		return nil, fmt.Errorf("get ssh key: %w", err)
	}

	privateKey, err := crypto.Decrypt(sshKey.PrivateKeyEncrypted, s.masterKey, "ssh-private-key")
	if err != nil {
		return nil, fmt.Errorf("decrypt ssh key: %w", err)
	}

	// 2. SSH connectivity check
	client, err := ssh.NewClient(req.Hostname, int(req.SSHPort), req.SSHUser, privateKey)
	if err != nil {
		return nil, fmt.Errorf("create ssh client: %w", err)
	}

	result, err := client.ConnectivityCheck(ctx)
	if err != nil {
		return nil, fmt.Errorf("connectivity check: %w", err)
	}

	s.logger.Info("connectivity check passed",
		"hostname", req.Hostname,
		"os", result.OS,
		"os_version", result.OSVersion,
		"arch", result.Arch,
		"has_sudo", result.HasSudo,
	)

	// 3. Validate OS
	if !isSupportedOS(result.OS, result.OSVersion) {
		return nil, fmt.Errorf("unsupported OS: %s %s (supported: ubuntu 22.04/24.04, debian 12)", result.OS, result.OSVersion)
	}

	// 4. Create server record
	ip, err := netip.ParseAddr(req.PublicIP)
	if err != nil {
		return nil, fmt.Errorf("invalid public IP: %w", err)
	}

	server, err := s.queries.CreateServer(ctx, db.CreateServerParams{
		TeamID:    req.TeamID,
		Name:      req.Name,
		Hostname:  req.Hostname,
		PublicIp:  ip,
		SshPort:   req.SSHPort,
		SshUser:   req.SSHUser,
		Os:        &result.OS,
		OsVersion: &result.OSVersion,
		Arch:      &result.Arch,
		Status:    "provisioning",
	})
	if err != nil {
		return nil, fmt.Errorf("create server: %w", err)
	}

	// 5. Attach SSH key
	err = s.queries.AttachSSHKeyToServer(ctx, db.AttachSSHKeyToServerParams{
		ServerID: server.ID,
		SshKeyID: req.SSHKeyID,
	})
	if err != nil {
		return nil, fmt.Errorf("attach ssh key: %w", err)
	}

	// 6. Generate + push installer script
	installerScript, err := provisioner.GetScript("docker")
	if err != nil {
		s.logger.Warn("installer script not found, skipping push", "error", err)
	} else {
		if pushErr := client.PushFile(ctx, installerScript, "/tmp/nixway-install.sh", "0755"); pushErr != nil {
			s.logger.Warn("failed to push installer script", "error", pushErr)
		} else {
			// 7. Execute installer (best-effort, non-blocking for onboarding response)
			go func() {
				output, execErr := client.RunCommand(context.Background(), "sudo /tmp/nixway-install.sh")
				if execErr != nil {
					s.logger.Error("installer execution failed",
						"server_id", server.ID,
						"error", execErr,
					)
				} else {
					s.logger.Info("installer executed successfully",
						"server_id", server.ID,
						"output_length", len(output),
					)
				}
			}()
		}
	}

	return &OnboardResult{Server: server}, nil
}
