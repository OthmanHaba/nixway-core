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
