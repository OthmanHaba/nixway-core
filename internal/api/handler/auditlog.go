package handler

import (
	"log/slog"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
)

type AuditLogHandler struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewAuditLogHandler(queries *db.Queries, logger *slog.Logger) *AuditLogHandler {
	return &AuditLogHandler{queries: queries, logger: logger}
}

func (h *AuditLogHandler) List(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeAuditRead); !ok {
		return
	}

	q := r.URL.Query()

	params := db.ListAuditLogsParams{
		TeamID:   pgtype.UUID{Bytes: teamID, Valid: true},
		PageSize: 50,
	}

	if v := q.Get("actor_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			params.ActorID = pgtype.UUID{Bytes: id, Valid: true}
		}
	}
	if v := q.Get("action"); v != "" {
		params.Action = &v
	}
	if v := q.Get("resource_type"); v != "" {
		params.ResourceType = &v
	}
	if v := q.Get("resource_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			params.ResourceID = pgtype.UUID{Bytes: id, Valid: true}
		}
	}
	if v := q.Get("before"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			params.After = pgtype.Timestamptz{Time: t, Valid: true}
		}
	}
	if v := q.Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			params.PageSize = int32(n)
		}
	}

	logs, err := h.queries.ListAuditLogs(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to list audit logs", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	result := make([]model.AuditLog, len(logs))
	for i, l := range logs {
		var teamIDPtr, actorIDPtr, resourceIDPtr *uuid.UUID
		if l.TeamID.Valid {
			id := uuid.UUID(l.TeamID.Bytes)
			teamIDPtr = &id
		}
		if l.ActorID.Valid {
			id := uuid.UUID(l.ActorID.Bytes)
			actorIDPtr = &id
		}
		if l.ResourceID.Valid {
			id := uuid.UUID(l.ResourceID.Bytes)
			resourceIDPtr = &id
		}

		var ipAddr netip.Addr
		if l.IpAddress != nil {
			ipAddr = *l.IpAddress
		}

		result[i] = model.AuditLog{
			ID:           l.ID,
			TeamID:       teamIDPtr,
			ActorID:      actorIDPtr,
			ActorType:    l.ActorType,
			ActorName:    l.ActorName,
			ActorEmail:   l.ActorEmail,
			Action:       l.Action,
			ResourceType: l.ResourceType,
			ResourceID:   resourceIDPtr,
			Metadata:     l.Metadata,
			IPAddress:    ipAddr,
			CreatedAt:    l.CreatedAt,
		}
	}

	respond.JSON(w, http.StatusOK, result)
}
