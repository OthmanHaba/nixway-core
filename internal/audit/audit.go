package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type Writer struct {
	queries *db.Queries
}

func NewWriter(queries *db.Queries) *Writer {
	return &Writer{queries: queries}
}

type Entry struct {
	TeamID       *uuid.UUID
	ActorID      *uuid.UUID
	ActorType    string
	Action       string
	ResourceType string
	ResourceID   *uuid.UUID
	Metadata     any
	IPAddress    netip.Addr
}

// Action constants for cross-package callers. Existing callers still pass
// inline strings; keep both styles working.
const (
	ActionDatabaseCredentialRotated = "database_credential_rotated"
	ActionDatabaseQueryExecuted     = "database_query_executed"
	ActionDatabaseBackupCreated     = "database_backup_created"
	ActionDatabaseBackupDeleted     = "database_backup_deleted"
	ActionDatabaseRestored          = "database_restored"
)

// WriteDatabaseBackupCreated records a manual backup trigger. Best-effort.
func (w *Writer) WriteDatabaseBackupCreated(ctx context.Context, teamID, actorID, databaseID, backupID uuid.UUID) error {
	return w.Log(ctx, Entry{
		TeamID:       &teamID,
		ActorID:      &actorID,
		ActorType:    "user",
		Action:       ActionDatabaseBackupCreated,
		ResourceType: "database",
		ResourceID:   &databaseID,
		Metadata: map[string]any{
			"backup_id": backupID.String(),
		},
	})
}

// WriteDatabaseBackupDeleted records a backup deletion. Best-effort.
func (w *Writer) WriteDatabaseBackupDeleted(ctx context.Context, teamID, actorID, databaseID, backupID uuid.UUID) error {
	return w.Log(ctx, Entry{
		TeamID:       &teamID,
		ActorID:      &actorID,
		ActorType:    "user",
		Action:       ActionDatabaseBackupDeleted,
		ResourceType: "database",
		ResourceID:   &databaseID,
		Metadata: map[string]any{
			"backup_id": backupID.String(),
		},
	})
}

// WriteDatabaseRestored records a restore from a backup. The targetMode is
// "in_place" or "new". When new, the targetDatabaseID may differ from the
// source databaseID. Best-effort.
func (w *Writer) WriteDatabaseRestored(ctx context.Context, teamID, actorID, databaseID, backupID, targetDatabaseID uuid.UUID, targetMode string) error {
	return w.Log(ctx, Entry{
		TeamID:       &teamID,
		ActorID:      &actorID,
		ActorType:    "user",
		Action:       ActionDatabaseRestored,
		ResourceType: "database",
		ResourceID:   &databaseID,
		Metadata: map[string]any{
			"backup_id":          backupID.String(),
			"target_database_id": targetDatabaseID.String(),
			"target_mode":        targetMode,
		},
	})
}

// WriteDatabaseCredentialRotated records a successful (or partial) rotation
// of a database's app-user credentials. Best-effort — caller logs but does
// not abort on failure to avoid losing the rotation success itself.
func (w *Writer) WriteDatabaseCredentialRotated(ctx context.Context, teamID, actorID, databaseID uuid.UUID, linkedAppCount int) error {
	return w.Log(ctx, Entry{
		TeamID:       &teamID,
		ActorID:      &actorID,
		ActorType:    "user",
		Action:       ActionDatabaseCredentialRotated,
		ResourceType: "database",
		ResourceID:   &databaseID,
		Metadata: map[string]any{
			"linked_apps_restarted": linkedAppCount,
		},
	})
}

// WriteDatabaseQueryExecuted records every query (read or write) the
// tooling UI runs. The query body is truncated to 500 chars in the audit
// metadata; the full query text lives in database_query_history. Best-
// effort — failure is logged by the caller but does not block the response.
func (w *Writer) WriteDatabaseQueryExecuted(
	ctx context.Context,
	teamID, actorID, databaseID uuid.UUID,
	query string,
	writeMode bool,
	rowCount int,
	executionTimeMS int64,
	success bool,
	queryError string,
) error {
	q := query
	if len(q) > 500 {
		q = q[:500] + "...(truncated)"
	}
	meta := map[string]any{
		"query":             q,
		"write_mode":        writeMode,
		"row_count":         rowCount,
		"execution_time_ms": executionTimeMS,
		"success":           success,
	}
	if queryError != "" {
		meta["error"] = queryError
	}
	return w.Log(ctx, Entry{
		TeamID:       &teamID,
		ActorID:      &actorID,
		ActorType:    "user",
		Action:       ActionDatabaseQueryExecuted,
		ResourceType: "database",
		ResourceID:   &databaseID,
		Metadata:     meta,
	})
}

func (w *Writer) Log(ctx context.Context, e Entry) error {
	var metadataJSON json.RawMessage
	if e.Metadata != nil {
		b, err := json.Marshal(e.Metadata)
		if err != nil {
			return fmt.Errorf("marshal metadata: %w", err)
		}
		metadataJSON = b
	}

	// Convert *uuid.UUID to pgtype.UUID
	teamID := pgtype.UUID{}
	if e.TeamID != nil {
		teamID = pgtype.UUID{Bytes: *e.TeamID, Valid: true}
	}
	actorID := pgtype.UUID{}
	if e.ActorID != nil {
		actorID = pgtype.UUID{Bytes: *e.ActorID, Valid: true}
	}
	resourceID := pgtype.UUID{}
	if e.ResourceID != nil {
		resourceID = pgtype.UUID{Bytes: *e.ResourceID, Valid: true}
	}

	ipAddr := &e.IPAddress

	_, err := w.queries.CreateAuditLog(ctx, db.CreateAuditLogParams{
		TeamID:       teamID,
		ActorID:      actorID,
		ActorType:    e.ActorType,
		Action:       e.Action,
		ResourceType: e.ResourceType,
		ResourceID:   resourceID,
		Metadata:     metadataJSON,
		IpAddress:    ipAddr,
	})
	if err != nil {
		return fmt.Errorf("create audit log: %w", err)
	}
	return nil
}
