package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// presignDuration is how long a presigned PUT/GET URL stays valid. Backups
// can take a while for large databases, so we err on the generous side.
const presignDuration = 30 * time.Minute

// schedulerInterval is how often the cron evaluator runs.
const schedulerInterval = 60 * time.Second

// errBackupStorageUnavailable is returned when the platform MinIO client is
// nil. We surface a friendly message that points the operator at the env vars
// they need to set so the failure is recoverable without code changes.
var errBackupStorageUnavailable = errors.New("backup storage not configured — set NIXWAY_PLATFORMSTORAGE_* env vars")

// CreateBackup triggers a manual backup of a database. The DB must be in the
// 'running' state. Returns the backup record once initiated; the actual dump
// runs asynchronously and is finalised by HandleBackupResult.
func (s *Service) CreateBackup(ctx context.Context, dbID, userID uuid.UUID) (*db.DatabaseBackup, error) {
	return s.createBackup(ctx, dbID, "manual", &userID)
}

// CreateScheduledBackup is the scheduler's entry point. It records the
// backup as type='scheduled' and triggered_by=NULL.
func (s *Service) CreateScheduledBackup(ctx context.Context, dbID uuid.UUID) (*db.DatabaseBackup, error) {
	return s.createBackup(ctx, dbID, "scheduled", nil)
}

func (s *Service) createBackup(ctx context.Context, dbID uuid.UUID, backupType string, userID *uuid.UUID) (*db.DatabaseBackup, error) {
	if s.minio == nil {
		return nil, errBackupStorageUnavailable
	}

	d, err := s.queries.GetDatabase(ctx, dbID)
	if err != nil {
		return nil, fmt.Errorf("get database: %w", err)
	}
	if d.Status != StatusRunning {
		return nil, fmt.Errorf("database must be running to back up (current: %s)", d.Status)
	}

	tool, ext := backupToolForTemplate(d.TemplateSlug)
	if tool == "" {
		return nil, fmt.Errorf("backup not supported for template: %s", d.TemplateSlug)
	}

	// Resolve the superuser password from the secrets store. We use BulkResolve
	// (system actor) so this bypasses the reveal-once flag — backups are an
	// automated operation, not a human-driven reveal.
	envNamespace := "database:" + d.Name
	resolved, err := s.secretSvc.BulkResolve(ctx, d.TeamID, envNamespace, []string{"SUPERUSER_PASSWORD"}, nil, "system")
	if err != nil {
		return nil, fmt.Errorf("resolve superuser secret: %w", err)
	}
	superPass := resolved["SUPERUSER_PASSWORD"]
	if superPass == "" {
		return nil, errors.New("superuser secret missing or empty")
	}

	triggeredBy := pgtype.UUID{}
	if userID != nil {
		triggeredBy = pgtype.UUID{Bytes: *userID, Valid: true}
	}

	rec, err := s.queries.CreateBackup(ctx, db.CreateBackupParams{
		DatabaseID:  dbID,
		Type:        backupType,
		Status:      "running",
		BackupTool:  tool,
		TriggeredBy: triggeredBy,
	})
	if err != nil {
		return nil, fmt.Errorf("create backup row: %w", err)
	}

	// Storage key: backups/<db_id>/<backup_id>.<ext> — keeps per-DB listings
	// trivial and matches the retention sweep prefix we use later.
	storageKey := fmt.Sprintf("backups/%s/%s%s", dbID.String(), rec.ID.String(), ext)
	outputFilename := rec.ID.String() + ext

	// Generate a presigned PUT URL for the agent to upload to.
	uploadURL, err := s.minio.PresignedPutURL(ctx, storageKey, presignDuration)
	if err != nil {
		s.markBackupFailed(ctx, rec.ID, fmt.Sprintf("presign put: %v", err))
		return &rec, fmt.Errorf("presign put url: %w", err)
	}

	// Build the BackupCommand and send it to the agent on the database's host.
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: d.ServerID, TeamID: d.TeamID})
	if err != nil {
		s.markBackupFailed(ctx, rec.ID, fmt.Sprintf("get server: %v", err))
		return &rec, fmt.Errorf("get server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		s.markBackupFailed(ctx, rec.ID, "server has no connected agent")
		return &rec, errors.New("server has no connected agent")
	}

	dbType := dbTypeForTemplate(d.TemplateSlug)
	dbname := defaultDBName(d.TemplateSlug, d.Name)

	cmd := &agentv1.BackupCommand{
		RequestId:         uuid.NewString(),
		BackupId:          rec.ID.String(),
		DatabaseId:        d.ID.String(),
		ContainerName:     d.ContainerName,
		DatabaseType:      dbType,
		Superuser:         superuserForTemplate(d.TemplateSlug),
		SuperuserPassword: superPass,
		Dbname:            dbname,
		Tool:              tool,
		OutputFilename:    outputFilename,
		UploadUrl:         uploadURL,
	}

	// We stash the storage_path on the row right away so the result handler
	// only has to flip status + size once the upload lands.
	if err := s.queries.UpdateBackupCompleted(ctx, db.UpdateBackupCompletedParams{
		ID:          rec.ID,
		SizeBytes:   nil,
		StoragePath: ptrString(storageKey),
	}); err != nil {
		// Non-fatal: we'll still update on result.
		s.logger.Warn("pre-set storage_path failed", "backup_id", rec.ID, "error", err)
	}
	// Re-set status to running because UpdateBackupCompleted flipped it.
	if err := s.queries.UpdateBackupStarted(ctx, rec.ID); err != nil {
		s.logger.Warn("re-set backup running status failed", "backup_id", rec.ID, "error", err)
	}

	if err := s.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_Backup{Backup: cmd},
	}); err != nil {
		s.markBackupFailed(ctx, rec.ID, fmt.Sprintf("send to agent: %v", err))
		return &rec, fmt.Errorf("send to agent: %w", err)
	}

	// Refresh the row so the caller sees the storage_path we just stamped.
	updated, err := s.queries.GetBackup(ctx, rec.ID)
	if err == nil {
		return &updated, nil
	}
	return &rec, nil
}

// GetBackup returns a single backup record.
func (s *Service) GetBackup(ctx context.Context, backupID uuid.UUID) (*db.DatabaseBackup, error) {
	rec, err := s.queries.GetBackup(ctx, backupID)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// ListBackups returns backup history for a database, newest first.
func (s *Service) ListBackups(ctx context.Context, dbID uuid.UUID) ([]db.DatabaseBackup, error) {
	return s.queries.ListBackupsByDatabase(ctx, dbID)
}

// DeleteBackup removes both the database row AND the underlying object in
// MinIO. Failure to delete the object is logged but does not block the row
// deletion (operators can clean up orphaned objects via the platform admin UI).
func (s *Service) DeleteBackup(ctx context.Context, backupID uuid.UUID) error {
	rec, err := s.queries.GetBackup(ctx, backupID)
	if err != nil {
		return fmt.Errorf("get backup: %w", err)
	}
	if rec.StoragePath != nil && *rec.StoragePath != "" && s.minio != nil {
		if err := s.minio.DeleteObject(ctx, *rec.StoragePath); err != nil {
			s.logger.Warn("delete backup object failed; row will still be removed",
				"backup_id", backupID, "key", *rec.StoragePath, "error", err)
		}
	}
	if err := s.queries.DeleteBackup(ctx, backupID); err != nil {
		return fmt.Errorf("delete backup row: %w", err)
	}
	return nil
}

// HandleBackupResult is the agent.Server callback for BackupResult messages.
// On success we record the size + (re-)set storage_path; on failure we mark
// the row failed with the agent's error string.
func (s *Service) HandleBackupResult(ctx context.Context, result *agentv1.BackupResult) {
	if result == nil || result.BackupId == "" {
		return
	}
	backupID, err := uuid.Parse(result.BackupId)
	if err != nil {
		s.logger.Warn("invalid backup_id in result", "backup_id", result.BackupId)
		return
	}

	if !result.Success {
		s.markBackupFailed(ctx, backupID, result.Error)
		return
	}

	size := result.SizeBytes
	var storagePath *string
	if result.StoragePath != "" {
		sp := result.StoragePath
		storagePath = &sp
	} else {
		// Fall back to the storage_path we stamped when the row was created.
		if rec, err := s.queries.GetBackup(ctx, backupID); err == nil {
			storagePath = rec.StoragePath
		}
	}

	if err := s.queries.UpdateBackupCompleted(ctx, db.UpdateBackupCompletedParams{
		ID:          backupID,
		SizeBytes:   &size,
		StoragePath: storagePath,
	}); err != nil {
		s.logger.Warn("update backup completed failed", "backup_id", backupID, "error", err)
		return
	}
	s.logger.Info("backup completed",
		"backup_id", backupID,
		"size_bytes", size,
	)

	// Run retention sweep for the parent DB.
	if rec, err := s.queries.GetBackup(ctx, backupID); err == nil {
		go s.runRetentionForDatabase(context.Background(), rec.DatabaseID)
	}
}

// markBackupFailed is a small helper that writes a failure status + error
// without bubbling DB errors up to its caller.
func (s *Service) markBackupFailed(ctx context.Context, backupID uuid.UUID, errMsg string) {
	msg := errMsg
	if err := s.queries.UpdateBackupFailed(ctx, db.UpdateBackupFailedParams{
		ID:    backupID,
		Error: &msg,
	}); err != nil {
		s.logger.Warn("mark backup failed errored", "backup_id", backupID, "error", err)
	}
}

// runRetentionForDatabase deletes backups + MinIO objects older than the
// database's backup_retention_days setting.
func (s *Service) runRetentionForDatabase(ctx context.Context, dbID uuid.UUID) {
	d, err := s.queries.GetDatabase(ctx, dbID)
	if err != nil {
		s.logger.Warn("retention: get database failed", "db_id", dbID, "error", err)
		return
	}
	days := int32(7)
	if d.BackupRetentionDays != nil && *d.BackupRetentionDays > 0 {
		days = *d.BackupRetentionDays
	}
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour)

	old, err := s.queries.ListBackupsOlderThan(ctx, db.ListBackupsOlderThanParams{
		DatabaseID: dbID,
		StartedAt:  cutoff,
	})
	if err != nil {
		s.logger.Warn("retention: list old backups failed", "db_id", dbID, "error", err)
		return
	}
	for _, b := range old {
		if b.StoragePath != nil && *b.StoragePath != "" && s.minio != nil {
			if err := s.minio.DeleteObject(ctx, *b.StoragePath); err != nil {
				s.logger.Warn("retention: delete object failed", "backup_id", b.ID, "key", *b.StoragePath, "error", err)
			}
		}
	}
	if err := s.queries.DeleteBackupsOlderThan(ctx, db.DeleteBackupsOlderThanParams{
		DatabaseID: dbID,
		StartedAt:  cutoff,
	}); err != nil {
		s.logger.Warn("retention: delete rows failed", "db_id", dbID, "error", err)
	}
}

// StartBackupScheduler launches a goroutine that ticks every minute and
// triggers backups for any database whose cron schedule has fired since its
// last completed backup. The goroutine exits when ctx is cancelled.
//
// Cron evaluation uses a tiny built-in parser (parseCronSchedule) that handles
// the standard 5-field "min hour dom mon dow" form plus the "@hourly", "@daily",
// "@weekly", "@monthly" and "@every <duration>" shortcuts. We avoid pulling in
// a full cron library — the scheduler only needs "has any fire-time elapsed
// since the last backup?" semantics.
func (s *Service) StartBackupScheduler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(schedulerInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.evaluateSchedules(ctx)
			}
		}
	}()
	s.logger.Info("backup scheduler started", "interval", schedulerInterval.String())
}

// evaluateSchedules runs one tick of the cron evaluator.
func (s *Service) evaluateSchedules(ctx context.Context) {
	if s.minio == nil {
		// No storage backend; nothing useful to do.
		return
	}
	dbs, err := s.queries.ListDatabasesWithBackupSchedule(ctx)
	if err != nil {
		s.logger.Warn("scheduler: list databases failed", "error", err)
		return
	}
	now := time.Now()
	for _, d := range dbs {
		if d.BackupSchedule == nil || strings.TrimSpace(*d.BackupSchedule) == "" {
			continue
		}
		schedule, err := parseCronSchedule(*d.BackupSchedule)
		if err != nil {
			s.logger.Warn("scheduler: invalid cron expression",
				"db_id", d.ID, "schedule", *d.BackupSchedule, "error", err)
			continue
		}

		var lastRun time.Time
		latest, err := s.queries.GetLatestBackupForDatabase(ctx, d.ID)
		if err == nil {
			lastRun = latest.StartedAt
		}

		// Skip: latest backup still running.
		if err == nil && latest.Status == "running" {
			continue
		}

		due := schedule.shouldRun(lastRun, now)
		if !due {
			continue
		}

		s.logger.Info("scheduler: triggering scheduled backup",
			"db_id", d.ID, "schedule", *d.BackupSchedule)
		if _, err := s.CreateScheduledBackup(ctx, d.ID); err != nil {
			s.logger.Warn("scheduler: create scheduled backup failed",
				"db_id", d.ID, "error", err)
		}
	}
}

// backupToolForTemplate returns ("pg_dump", ".dump") etc for a template.
// Returns ("", "") when the template has no supported backup tool.
func backupToolForTemplate(slug string) (tool, ext string) {
	switch strings.ToLower(slug) {
	case "postgres", "postgresql":
		return "pg_dump", ".dump"
	case "mysql", "mariadb":
		return "mysqldump", ".sql"
	case "mongodb", "mongo":
		return "mongodump", ".archive"
	case "redis":
		return "redis-bgsave", ".rdb"
	default:
		return "", ""
	}
}

// restoreToolForBackupTool maps a backup_tool to its restore counterpart.
func restoreToolForBackupTool(backupTool string) string {
	switch backupTool {
	case "pg_dump":
		return "pg_restore"
	case "mysqldump":
		return "mysql"
	case "mongodump":
		return "mongorestore"
	case "redis-bgsave":
		return "redis-load"
	default:
		return ""
	}
}

// superuserForTemplate returns the conventional superuser name baked into the
// official container images.
func superuserForTemplate(slug string) string {
	switch strings.ToLower(slug) {
	case "postgres", "postgresql":
		return "postgres"
	case "mysql", "mariadb":
		return "root"
	case "mongodb", "mongo":
		return "admin"
	case "redis":
		return "" // requirepass auth, no separate user
	default:
		return ""
	}
}

// defaultDBName returns the conventional database name to dump. Postgres uses
// the DB's own name (matches the env-template substitution), MySQL picks the
// db named in env, Mongo dumps `admin` by default and Redis is N/A.
func defaultDBName(slug, dbName string) string {
	switch strings.ToLower(slug) {
	case "postgres", "postgresql":
		return dbName
	case "mysql", "mariadb":
		return dbName
	default:
		return ""
	}
}

func ptrString(s string) *string { return &s }
