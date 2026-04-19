package handler

import (
	"log/slog"
	"net/http"

	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/discovery"
)

type DiscoveryHandler struct {
	logger *slog.Logger
}

func NewDiscoveryHandler(logger *slog.Logger) *DiscoveryHandler {
	return &DiscoveryHandler{logger: logger}
}

type discoverRequest struct {
	Path string `json:"path"`
}

func (h *DiscoveryHandler) Discover(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req discoverRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Path == "" {
		respond.Error(w, http.StatusBadRequest, "path is required")
		return
	}

	candidates, err := discovery.Discover(req.Path)
	if err != nil {
		h.logger.Error("discovery failed", "error", err)
		respond.Error(w, http.StatusInternalServerError, "discovery failed")
		return
	}

	respond.JSON(w, http.StatusOK, candidates)
}
