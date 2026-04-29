package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// restoreTimeout caps the synchronous wait for the agent's RestoreResult.
// 10 minutes is generous for tens-of-GB restores; larger ones should be
// driven via the maintenance window flow we'll add in v2.
const restoreTimeout = 10 * time.Minute

// RestoreTargetMode controls where a restore is applied.
type RestoreTargetMode string

const (
	// RestoreInPlace applies the backup to the same database that owns it.
	// All existing data is overwritten by the restore tool's --clean / --drop
	// behaviour (per engine).
	RestoreInPlace RestoreTargetMode = "in_place"

	// RestoreNewDatabase provisions a fresh database with the same template
	// and version as the source, then restores into it. The new database
	// inherits the source's cluster.
	RestoreNewDatabase RestoreTargetMode = "new"
)

// RestoreResult is the response shape from RestoreFromBackup. The Database is
// the target (same as source for in-place; the freshly-provisioned one for
// "new"). RestartRequired is true for engines whose restore semantics need
// the operator to bounce the container (currently: redis).
type RestoreResult struct {
	Database        db.Database `json:"database"`
	RestartRequired bool        `json:"restart_required"`
	Note            string      `json:"note,omitempty"`
}

// RestoreFromBackup downloads a backup from MinIO via a presigned URL and
// runs the engine-specific restore tool against the target database.
//
// targetMode == "in_place": apply to the source database in-place. The agent's
// pg_restore / mysql / mongorestore commands use --clean/--drop so existing
// objects are replaced.
//
// targetMode == "new": provision a brand-new database (same template/version
// as the source, in the same cluster) and restore into it. The newName is
// optional; if empty, a name is auto-generated.
//
// The wait is synchronous (bounded by restoreTimeout) — restores are
// infrequent and the user wants immediate confirmation.
func (s *Service) RestoreFromBackup(ctx context.Context, backupID, userID uuid.UUID, targetMode string, newName string) (*RestoreResult, error) {
	if s.minio == nil {
		return nil, errBackupStorageUnavailable
	}

	backup, err := s.queries.GetBackup(ctx, backupID)
	if err != nil {
		return nil, fmt.Errorf("get backup: %w", err)
	}
	if backup.Status != "completed" {
		return nil, fmt.Errorf("backup is not completed (status: %s)", backup.Status)
	}
	if backup.StoragePath == nil || *backup.StoragePath == "" {
		return nil, errors.New("backup has no storage_path")
	}

	source, err := s.queries.GetDatabase(ctx, backup.DatabaseID)
	if err != nil {
		return nil, fmt.Errorf("get source database: %w", err)
	}

	// Resolve the target database.
	var target db.Database
	switch RestoreTargetMode(targetMode) {
	case RestoreInPlace, "":
		target = source
	case RestoreNewDatabase:
		// Provision a fresh DB with the same template + version + cluster.
		req := ProvisionRequest{
			TeamID:        source.TeamID,
			ProjectID:     source.ProjectID,
			ClusterID:     source.ClusterID,
			TemplateSlug:  source.TemplateSlug,
			Version:       source.Version,
			Name:          newName,
			CPUMillicores: int(source.ResourceCpuMillicores),
			MemoryMB:      int(source.ResourceMemoryMb),
		}
		provisioned, err := s.Provision(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("provision target database: %w", err)
		}
		target = provisioned.Database
	default:
		return nil, fmt.Errorf("invalid target mode: %s (expected 'in_place' or 'new')", targetMode)
	}

	if target.Status != StatusRunning {
		return nil, fmt.Errorf("target database must be running (current: %s)", target.Status)
	}

	// Resolve the target's superuser password from secrets.
	envNamespace := "database:" + target.Name
	resolved, err := s.secretSvc.BulkResolve(ctx, target.TeamID, envNamespace, []string{"SUPERUSER_PASSWORD"}, nil, "system")
	if err != nil {
		return nil, fmt.Errorf("resolve target superuser secret: %w", err)
	}
	superPass := resolved["SUPERUSER_PASSWORD"]
	if superPass == "" {
		return nil, errors.New("target superuser secret missing or empty")
	}

	// Generate a presigned GET URL for the agent to download from.
	downloadURL, err := s.minio.PresignedGetURL(ctx, *backup.StoragePath, presignDuration)
	if err != nil {
		return nil, fmt.Errorf("presign get url: %w", err)
	}

	// Look up the target's host agent.
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: target.ServerID, TeamID: target.TeamID})
	if err != nil {
		return nil, fmt.Errorf("get target server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		return nil, errors.New("target server has no connected agent")
	}

	tool := restoreToolForBackupTool(backup.BackupTool)
	if tool == "" {
		return nil, fmt.Errorf("no restore tool for backup tool: %s", backup.BackupTool)
	}

	requestID := uuid.NewString()
	ch := make(chan *agentv1.RestoreResult, 1)
	s.mu.Lock()
	s.pendingRestore[requestID] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pendingRestore, requestID)
		s.mu.Unlock()
	}()

	cmd := &agentv1.RestoreCommand{
		RequestId:         requestID,
		BackupId:          backup.ID.String(),
		DatabaseId:        target.ID.String(),
		ContainerName:     target.ContainerName,
		DatabaseType:      dbTypeForTemplate(target.TemplateSlug),
		Superuser:         superuserForTemplate(target.TemplateSlug),
		SuperuserPassword: superPass,
		Dbname:            defaultDBName(target.TemplateSlug, target.Name),
		Tool:              tool,
		DownloadUrl:       downloadURL,
	}
	if err := s.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_Restore{Restore: cmd},
	}); err != nil {
		return nil, fmt.Errorf("send restore to agent: %w", err)
	}

	timeout := restoreTimeout
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 && remaining < timeout {
			timeout = remaining
		}
	}

	select {
	case res := <-ch:
		if res == nil {
			return nil, errors.New("nil restore result from agent")
		}
		if !res.Success {
			return nil, fmt.Errorf("restore failed: %s", res.Error)
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(timeout):
		return nil, errors.New("timed out waiting for restore result")
	}

	out := &RestoreResult{Database: target}
	if tool == "redis-load" {
		out.RestartRequired = true
		out.Note = "redis-load placed dump.rdb but the container must be restarted for it to take effect."
	}
	return out, nil
}

// HandleRestoreResult is the agent.Server callback for RestoreResult messages.
func (s *Service) HandleRestoreResult(ctx context.Context, result *agentv1.RestoreResult) {
	if result == nil || result.RequestId == "" {
		return
	}
	s.mu.Lock()
	ch, ok := s.pendingRestore[result.RequestId]
	if ok {
		delete(s.pendingRestore, result.RequestId)
	}
	s.mu.Unlock()
	if !ok {
		return
	}
	select {
	case ch <- result:
	default:
	}
}
