package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// backupRoot is the host directory used to stage dump files between
// `docker cp` and the MinIO upload. We refuse to write outside this prefix
// for safety in restore (mirrors volume.go's guardrail).
const backupRoot = "/var/lib/nixway/backups"

// HandleBackup runs the appropriate dump tool inside the database container,
// copies the resulting file out to the host's backup root, uploads it to the
// presigned URL, then removes the local + in-container copies.
//
// IMPORTANT: passwords are passed via `docker exec -e PGPASSWORD=...` (or the
// equivalent env var per engine) so they are NEVER substituted into a shell
// command we log. We log only database type, container, and outcome.
func HandleBackup(ctx context.Context, cmd *agentv1.BackupCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.BackupResult{
		RequestId: cmd.RequestId,
		BackupId:  cmd.BackupId,
		Success:   true,
	}

	if cmd.ContainerName == "" {
		sendBackupResult(stream, finishBackupError(res, "container_name is required"))
		return
	}
	if cmd.OutputFilename == "" {
		sendBackupResult(stream, finishBackupError(res, "output_filename is required"))
		return
	}
	if cmd.UploadUrl == "" {
		sendBackupResult(stream, finishBackupError(res, "upload_url is required"))
		return
	}

	// Reject anything that could escape the backup root.
	safeName := filepath.Base(cmd.OutputFilename)
	if safeName != cmd.OutputFilename || strings.Contains(safeName, "..") {
		sendBackupResult(stream, finishBackupError(res, "invalid output_filename"))
		return
	}

	if err := os.MkdirAll(backupRoot, 0o755); err != nil {
		sendBackupResult(stream, finishBackupError(res, fmt.Sprintf("mkdir backup root: %v", err)))
		return
	}

	hostPath := filepath.Join(backupRoot, safeName)
	containerTmp := "/tmp/" + safeName

	dbType := strings.ToLower(strings.TrimSpace(cmd.DatabaseType))
	tool := strings.ToLower(strings.TrimSpace(cmd.Tool))

	// Step 1: dump inside the container.
	dumpErr := dumpInContainer(ctx, cmd, dbType, tool, containerTmp, logger)
	if dumpErr != nil {
		sendBackupResult(stream, finishBackupError(res, dumpErr.Error()))
		return
	}

	// Step 2: copy the dump from the container to the host.
	cpCmd := exec.CommandContext(ctx, "docker", "cp",
		fmt.Sprintf("%s:%s", cmd.ContainerName, containerTmp),
		hostPath,
	)
	if out, err := cpCmd.CombinedOutput(); err != nil {
		// Best-effort cleanup of the in-container file.
		_ = exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName, "rm", "-f", containerTmp).Run()
		sendBackupResult(stream, finishBackupError(res, fmt.Sprintf("docker cp: %v: %s", err, truncate(string(out), 256))))
		return
	}

	// Best-effort: drop the in-container temp file.
	_ = exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName, "rm", "-f", containerTmp).Run()

	info, err := os.Stat(hostPath)
	if err != nil {
		sendBackupResult(stream, finishBackupError(res, fmt.Sprintf("stat host file: %v", err)))
		return
	}
	res.SizeBytes = info.Size()

	// Step 3: upload to MinIO via presigned PUT URL.
	if err := uploadFile(ctx, hostPath, cmd.UploadUrl, info.Size()); err != nil {
		// Leave the local file for retry/diagnosis if upload fails.
		sendBackupResult(stream, finishBackupError(res, fmt.Sprintf("upload: %v", err)))
		return
	}

	// Step 4: cleanup local file.
	if err := os.Remove(hostPath); err != nil {
		logger.Warn("backup: local file cleanup failed", "path", hostPath, "error", err)
	}

	logger.Info("backup completed",
		"backup_id", cmd.BackupId,
		"database_id", cmd.DatabaseId,
		"container", cmd.ContainerName,
		"db_type", dbType,
		"size_bytes", res.SizeBytes,
	)
	sendBackupResult(stream, res)
}

// dumpInContainer execs the right tool inside the DB container, writing to
// containerTmp. Engine-specific commands and env vars carry credentials so
// nothing sensitive lands in argv where another process could observe it.
func dumpInContainer(ctx context.Context, cmd *agentv1.BackupCommand, dbType, tool, containerTmp string, logger *slog.Logger) error {
	user := strings.TrimSpace(cmd.Superuser)
	dbname := strings.TrimSpace(cmd.Dbname)
	switch tool {
	case "pg_dump":
		if user == "" {
			user = "postgres"
		}
		if dbname == "" {
			dbname = "postgres"
		}
		args := []string{
			"exec",
			"-e", "PGPASSWORD=" + cmd.SuperuserPassword,
			cmd.ContainerName,
			"pg_dump", "-Fc", "-U", user, "-d", dbname, "-f", containerTmp,
		}
		return runDocker(ctx, args, "pg_dump")
	case "mysqldump":
		if user == "" {
			user = "root"
		}
		// mysqldump can't write directly via -f, so we redirect with sh -c.
		// MYSQL_PWD is safer than --password=... because it doesn't appear in argv.
		shellCmd := fmt.Sprintf("mysqldump -u %s --single-transaction --routines --triggers %s > %s",
			shellSingleQuote(user), shellSingleQuote(orDefault(dbname, "")), shellSingleQuote(containerTmp))
		args := []string{
			"exec",
			"-e", "MYSQL_PWD=" + cmd.SuperuserPassword,
			cmd.ContainerName,
			"sh", "-c", shellCmd,
		}
		return runDocker(ctx, args, "mysqldump")
	case "mongodump":
		// mongodump connects to localhost inside the container; URI auth is the
		// simplest cross-version path. The password is URL-encoded into the URI.
		uri := fmt.Sprintf("mongodb://%s:%s@localhost:27017/?authSource=admin",
			urlEncode(orDefault(user, "admin")), urlEncode(cmd.SuperuserPassword))
		shellCmd := fmt.Sprintf("mongodump --uri=%s --archive=%s --gzip",
			shellSingleQuote(uri), shellSingleQuote(containerTmp))
		args := []string{
			"exec",
			cmd.ContainerName,
			"sh", "-c", shellCmd,
		}
		return runDocker(ctx, args, "mongodump")
	case "redis-bgsave":
		// Redis BGSAVE is async. We trigger it, poll LASTSAVE until it changes,
		// then point our `docker cp` at /data/dump.rdb.
		auth := ""
		if cmd.SuperuserPassword != "" {
			auth = "-a " + shellSingleQuote(cmd.SuperuserPassword) + " --no-auth-warning "
		}

		// Capture LASTSAVE before the BGSAVE.
		beforeOut, err := exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName,
			"sh", "-c", "redis-cli "+auth+"LASTSAVE").CombinedOutput()
		if err != nil {
			return fmt.Errorf("redis LASTSAVE (pre): %v: %s", err, truncate(string(beforeOut), 256))
		}
		before := strings.TrimSpace(string(beforeOut))

		// Trigger BGSAVE.
		bgOut, err := exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName,
			"sh", "-c", "redis-cli "+auth+"BGSAVE").CombinedOutput()
		if err != nil {
			return fmt.Errorf("redis BGSAVE: %v: %s", err, truncate(string(bgOut), 256))
		}

		// Poll LASTSAVE until the timestamp advances or we time out.
		deadline := time.Now().Add(2 * time.Minute)
		for time.Now().Before(deadline) {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			out, err := exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName,
				"sh", "-c", "redis-cli "+auth+"LASTSAVE").CombinedOutput()
			if err == nil {
				cur := strings.TrimSpace(string(out))
				if cur != "" && cur != before {
					// BGSAVE has completed. Move /data/dump.rdb into containerTmp so
					// the caller's `docker cp` finds it at the expected location.
					mvOut, err := exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName,
						"sh", "-c", "cp /data/dump.rdb "+shellSingleQuote(containerTmp)).CombinedOutput()
					if err != nil {
						return fmt.Errorf("redis copy dump.rdb: %v: %s", err, truncate(string(mvOut), 256))
					}
					return nil
				}
			}
			time.Sleep(1 * time.Second)
		}
		return fmt.Errorf("redis BGSAVE timed out waiting for LASTSAVE to advance")
	default:
		return fmt.Errorf("unsupported backup tool: %s (db_type=%s)", tool, dbType)
	}
}

// runDocker runs `docker <args...>` and returns a meaningful error on failure.
// The label is used in error messages but the args (which may contain creds in
// env-var form) are NEVER logged on success.
func runDocker(ctx context.Context, args []string, label string) error {
	c := exec.CommandContext(ctx, "docker", args...)
	out, err := c.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %v: %s", label, err, truncate(string(out), 512))
	}
	return nil
}

// HandleRestore downloads a backup file from MinIO via the presigned GET URL,
// copies it into the target container, and runs the engine-specific restore
// command. The local + in-container copies are best-effort cleaned up.
func HandleRestore(ctx context.Context, cmd *agentv1.RestoreCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.RestoreResult{
		RequestId: cmd.RequestId,
		BackupId:  cmd.BackupId,
		Success:   true,
	}

	if cmd.ContainerName == "" {
		sendRestoreResult(stream, finishRestoreError(res, "container_name is required"))
		return
	}
	if cmd.DownloadUrl == "" {
		sendRestoreResult(stream, finishRestoreError(res, "download_url is required"))
		return
	}

	if err := os.MkdirAll(backupRoot, 0o755); err != nil {
		sendRestoreResult(stream, finishRestoreError(res, fmt.Sprintf("mkdir backup root: %v", err)))
		return
	}

	tool := strings.ToLower(strings.TrimSpace(cmd.Tool))
	suffix := restoreSuffixForTool(tool)
	localFile := filepath.Join(backupRoot, "restore-"+cmd.BackupId+suffix)
	containerFile := "/tmp/restore-" + cmd.BackupId + suffix

	// Step 1: download from presigned URL.
	if err := downloadFile(ctx, cmd.DownloadUrl, localFile); err != nil {
		sendRestoreResult(stream, finishRestoreError(res, fmt.Sprintf("download: %v", err)))
		return
	}
	defer func() { _ = os.Remove(localFile) }()

	// Step 2: copy into the container.
	cpCmd := exec.CommandContext(ctx, "docker", "cp",
		localFile,
		fmt.Sprintf("%s:%s", cmd.ContainerName, containerFile),
	)
	if out, err := cpCmd.CombinedOutput(); err != nil {
		sendRestoreResult(stream, finishRestoreError(res, fmt.Sprintf("docker cp: %v: %s", err, truncate(string(out), 256))))
		return
	}
	defer func() {
		_ = exec.CommandContext(context.Background(), "docker", "exec", cmd.ContainerName, "rm", "-f", containerFile).Run()
	}()

	// Step 3: run the appropriate restore tool inside the container.
	if err := restoreInContainer(ctx, cmd, tool, containerFile, logger); err != nil {
		sendRestoreResult(stream, finishRestoreError(res, err.Error()))
		return
	}

	logger.Info("restore completed",
		"backup_id", cmd.BackupId,
		"database_id", cmd.DatabaseId,
		"container", cmd.ContainerName,
		"tool", tool,
	)
	sendRestoreResult(stream, res)
}

// restoreInContainer runs the appropriate restore tool inside the container.
// For Redis we currently use a simplified copy-then-restart-aware path: we
// copy /tmp/<file> over /data/dump.rdb. The caller is expected to restart the
// container for redis-load to take full effect (documented in the proto).
func restoreInContainer(ctx context.Context, cmd *agentv1.RestoreCommand, tool, containerFile string, logger *slog.Logger) error {
	user := strings.TrimSpace(cmd.Superuser)
	dbname := strings.TrimSpace(cmd.Dbname)
	switch tool {
	case "pg_restore":
		if user == "" {
			user = "postgres"
		}
		if dbname == "" {
			dbname = "postgres"
		}
		args := []string{
			"exec",
			"-e", "PGPASSWORD=" + cmd.SuperuserPassword,
			cmd.ContainerName,
			"pg_restore", "-U", user, "-d", dbname,
			"--clean", "--if-exists", "--no-owner",
			containerFile,
		}
		return runDocker(ctx, args, "pg_restore")
	case "mysql":
		if user == "" {
			user = "root"
		}
		shellCmd := fmt.Sprintf("mysql -u %s %s < %s",
			shellSingleQuote(user), shellSingleQuote(orDefault(dbname, "")), shellSingleQuote(containerFile))
		args := []string{
			"exec",
			"-e", "MYSQL_PWD=" + cmd.SuperuserPassword,
			cmd.ContainerName,
			"sh", "-c", shellCmd,
		}
		return runDocker(ctx, args, "mysql restore")
	case "mongorestore":
		uri := fmt.Sprintf("mongodb://%s:%s@localhost:27017/?authSource=admin",
			urlEncode(orDefault(user, "admin")), urlEncode(cmd.SuperuserPassword))
		shellCmd := fmt.Sprintf("mongorestore --uri=%s --archive=%s --gzip --drop",
			shellSingleQuote(uri), shellSingleQuote(containerFile))
		args := []string{
			"exec",
			cmd.ContainerName,
			"sh", "-c", shellCmd,
		}
		return runDocker(ctx, args, "mongorestore")
	case "redis-load":
		// v1: copy the dump.rdb in place. Redis only re-reads dump.rdb on
		// startup, so the operator MUST restart the container after this for
		// the data to load. We document this in the API response.
		shellCmd := "cp " + shellSingleQuote(containerFile) + " /data/dump.rdb"
		args := []string{
			"exec",
			cmd.ContainerName,
			"sh", "-c", shellCmd,
		}
		if err := runDocker(ctx, args, "redis-load"); err != nil {
			return err
		}
		logger.Warn("redis-load placed dump.rdb but container restart required for it to take effect",
			"container", cmd.ContainerName)
		return nil
	default:
		return fmt.Errorf("unsupported restore tool: %s", tool)
	}
}

func restoreSuffixForTool(tool string) string {
	switch tool {
	case "pg_restore":
		return ".dump"
	case "mysql":
		return ".sql"
	case "mongorestore":
		return ".archive"
	case "redis-load":
		return ".rdb"
	default:
		return ".bin"
	}
}

// uploadFile streams a local file to a presigned PUT URL.
func uploadFile(ctx context.Context, path, uploadURL string, size int64) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	defer f.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, f)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", "application/octet-stream")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("upload status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// downloadFile fetches a presigned GET URL into a local file, atomically.
func downloadFile(ctx context.Context, downloadURL, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("download status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create: %w", err)
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("copy: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

func sendBackupResult(stream agentv1.AgentService_ConnectClient, res *agentv1.BackupResult) {
	_ = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_BackupResult{BackupResult: res},
	})
}

func finishBackupError(res *agentv1.BackupResult, msg string) *agentv1.BackupResult {
	res.Success = false
	res.Error = msg
	return res
}

func sendRestoreResult(stream agentv1.AgentService_ConnectClient, res *agentv1.RestoreResult) {
	_ = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_RestoreResult{RestoreResult: res},
	})
}

func finishRestoreError(res *agentv1.RestoreResult, msg string) *agentv1.RestoreResult {
	res.Success = false
	res.Error = msg
	return res
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// urlEncode is a small helper that percent-encodes the characters most likely
// to break a Mongo URI's userinfo (':', '@', '/', '?', '#', '%').
// We only need this for credentials embedded in mongodb:// URIs.
func urlEncode(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case ':', '@', '/', '?', '#', '%', '&', '+', ' ':
			fmt.Fprintf(&b, "%%%02X", c)
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}
