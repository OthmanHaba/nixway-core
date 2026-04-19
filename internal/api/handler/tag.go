package handler

import (
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type TagHandler struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewTagHandler(queries *db.Queries, logger *slog.Logger) *TagHandler {
	return &TagHandler{queries: queries, logger: logger}
}

func (h *TagHandler) List(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	tags, err := h.queries.ListServerTags(r.Context(), serverID)
	if err != nil {
		h.logger.Error("failed to list tags", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respond.JSON(w, http.StatusOK, tags)
}

type setTagRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (h *TagHandler) Set(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	var req setTagRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Key == "" {
		respond.Error(w, http.StatusBadRequest, "key is required")
		return
	}

	tag, err := h.queries.SetServerTag(r.Context(), db.SetServerTagParams{
		ServerID: serverID,
		Key:      req.Key,
		Value:    req.Value,
	})
	if err != nil {
		h.logger.Error("failed to set tag", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to set tag")
		return
	}

	respond.JSON(w, http.StatusOK, tag)
}

func (h *TagHandler) Delete(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	key := r.PathValue("key")
	if key == "" {
		respond.Error(w, http.StatusBadRequest, "tag key is required")
		return
	}

	err = h.queries.DeleteServerTag(r.Context(), db.DeleteServerTagParams{
		ServerID: serverID,
		Key:      key,
	})
	if err != nil {
		h.logger.Error("failed to delete tag", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete tag")
		return
	}

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
