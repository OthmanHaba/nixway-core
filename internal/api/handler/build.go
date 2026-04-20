package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/build"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type BuildHandler struct {
	queries  *db.Queries
	buildSvc *build.Service
	redis    *redis.Client
	logger   *slog.Logger
}

func NewBuildHandler(queries *db.Queries, buildSvc *build.Service, redisClient *redis.Client, logger *slog.Logger) *BuildHandler {
	return &BuildHandler{
		queries:  queries,
		buildSvc: buildSvc,
		redis:    redisClient,
		logger:   logger,
	}
}

type triggerBuildRequest struct {
	EnvironmentID string `json:"environment_id"`
	CommitSHA     string `json:"commit_sha"`
	Branch        string `json:"branch"`
}

// TriggerBuild handles POST /api/v1/apps/{appId}/builds
func (h *BuildHandler) TriggerBuild(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}

	var req triggerBuildRequest
	// Body is optional — if empty, defaults to production environment
	_ = respond.DecodeJSON(r, &req)

	var envID uuid.UUID
	if req.EnvironmentID != "" {
		envID, err = uuid.Parse(req.EnvironmentID)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid environment_id")
			return
		}
	} else {
		// Auto-resolve: find the app's project, then its production environment
		app, err := h.queries.GetApp(r.Context(), appID)
		if err != nil {
			respond.Error(w, http.StatusNotFound, "app not found")
			return
		}
		envs, err := h.queries.ListEnvironmentsByProject(r.Context(), app.ProjectID)
		if err != nil || len(envs) == 0 {
			respond.Error(w, http.StatusBadRequest, "no environments found for this project")
			return
		}
		// Prefer production, fallback to first
		envID = envs[0].ID
		for _, env := range envs {
			if env.IsProduction {
				envID = env.ID
				break
			}
		}
	}

	b, err := h.buildSvc.TriggerBuild(r.Context(), appID, envID, "manual", req.CommitSHA, req.Branch)
	if err != nil {
		h.logger.Error("failed to trigger build", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to trigger build")
		return
	}

	respond.JSON(w, http.StatusCreated, b)
}

// List handles GET /api/v1/apps/{appId}/builds
func (h *BuildHandler) List(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}

	limit := int32(20)
	offset := int32(0)
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = int32(v)
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = int32(v)
		}
	}

	builds, err := h.queries.ListBuildsByApp(r.Context(), db.ListBuildsByAppParams{
		AppID:  appID,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		h.logger.Error("failed to list builds", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list builds")
		return
	}

	respond.JSON(w, http.StatusOK, builds)
}

// Get handles GET /api/v1/apps/{appId}/builds/{buildId}
func (h *BuildHandler) Get(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	buildID, err := uuid.Parse(r.PathValue("buildId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid build ID")
		return
	}

	b, err := h.queries.GetBuild(r.Context(), buildID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "build not found")
		return
	}

	respond.JSON(w, http.StatusOK, b)
}

// StreamLogs handles GET /api/v1/apps/{appId}/builds/{buildId}/logs (SSE)
func (h *BuildHandler) StreamLogs(w http.ResponseWriter, r *http.Request) {
	buildID, err := uuid.Parse(r.PathValue("buildId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid build ID")
		return
	}

	// Verify build exists
	b, err := h.queries.GetBuild(r.Context(), buildID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "build not found")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		respond.Error(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Send existing logs first — split by line since SSE data fields can't contain raw newlines
	if b.Logs != "" {
		for _, line := range strings.Split(b.Logs, "\n") {
			if line != "" {
				fmt.Fprintf(w, "data: %s\n\n", line)
			}
		}
		flusher.Flush()
	}

	// If build is already finished, close
	if b.Status == "built" || b.Status == "failed" || b.Status == "cancelled" {
		fmt.Fprintf(w, "event: done\ndata: %s\n\n", b.Status)
		flusher.Flush()
		return
	}

	// Subscribe to Redis pub/sub for live logs
	channel := fmt.Sprintf("build:%s", buildID)
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if msg.Payload == "__done__" {
				fmt.Fprintf(w, "event: done\ndata: done\n\n")
				flusher.Flush()
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
