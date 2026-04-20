package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/deploy"
)

type DeployHandler struct {
	queries   *db.Queries
	deploySvc *deploy.Service
	connMgr   *agent.ConnManager
	redis     *redis.Client
	logger    *slog.Logger
}

func NewDeployHandler(queries *db.Queries, deploySvc *deploy.Service, connMgr *agent.ConnManager, redisClient *redis.Client, logger *slog.Logger) *DeployHandler {
	return &DeployHandler{
		queries:   queries,
		deploySvc: deploySvc,
		connMgr:   connMgr,
		redis:     redisClient,
		logger:    logger,
	}
}

type triggerDeployRequest struct {
	EnvironmentID string `json:"environment_id"`
	BuildID       string `json:"build_id"`
	ServerID      string `json:"server_id"`
}

// TriggerDeploy handles POST /api/v1/apps/{appId}/deployments
func (h *DeployHandler) TriggerDeploy(w http.ResponseWriter, r *http.Request) {
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

	var req triggerDeployRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	envID, err := uuid.Parse(req.EnvironmentID)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid environment_id")
		return
	}

	buildID, err := uuid.Parse(req.BuildID)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid build_id")
		return
	}

	var serverID *uuid.UUID
	if req.ServerID != "" {
		sid, err := uuid.Parse(req.ServerID)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid server_id")
			return
		}
		serverID = &sid
	}

	d, err := h.deploySvc.TriggerDeploy(r.Context(), appID, envID, buildID, serverID)
	if err != nil {
		h.logger.Error("failed to trigger deploy", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to trigger deploy")
		return
	}

	respond.JSON(w, http.StatusCreated, d)
}

// List handles GET /api/v1/apps/{appId}/deployments
func (h *DeployHandler) List(w http.ResponseWriter, r *http.Request) {
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

	deployments, err := h.queries.ListDeploymentsByApp(r.Context(), db.ListDeploymentsByAppParams{
		AppID:  appID,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		h.logger.Error("failed to list deployments", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list deployments")
		return
	}

	respond.JSON(w, http.StatusOK, deployments)
}

// Get handles GET /api/v1/apps/{appId}/deployments/{deployId}
func (h *DeployHandler) Get(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	deployID, err := uuid.Parse(r.PathValue("deployId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid deploy ID")
		return
	}

	d, err := h.queries.GetDeployment(r.Context(), deployID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "deployment not found")
		return
	}

	respond.JSON(w, http.StatusOK, d)
}

// Rollback handles POST /api/v1/apps/{appId}/rollback
func (h *DeployHandler) Rollback(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		EnvironmentID string `json:"environment_id"`
	}
	_ = respond.DecodeJSON(r, &req)

	var envID uuid.UUID
	if req.EnvironmentID != "" {
		envID, err = uuid.Parse(req.EnvironmentID)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid environment_id")
			return
		}
	} else {
		// Auto-resolve production environment
		app, err := h.queries.GetApp(r.Context(), appID)
		if err != nil {
			respond.Error(w, http.StatusNotFound, "app not found")
			return
		}
		envs, err := h.queries.ListEnvironmentsByProject(r.Context(), app.ProjectID)
		if err != nil || len(envs) == 0 {
			respond.Error(w, http.StatusBadRequest, "no environments found")
			return
		}
		envID = envs[0].ID
		for _, env := range envs {
			if env.IsProduction {
				envID = env.ID
				break
			}
		}
	}

	d, err := h.deploySvc.Rollback(r.Context(), appID, envID)
	if err != nil {
		h.logger.Error("failed to rollback", "error", err)
		respond.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	respond.JSON(w, http.StatusCreated, d)
}

// StreamLogs handles GET /api/v1/apps/{appId}/deployments/{deployId}/logs (SSE)
func (h *DeployHandler) StreamLogs(w http.ResponseWriter, r *http.Request) {
	deployID, err := uuid.Parse(r.PathValue("deployId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid deploy ID")
		return
	}

	d, err := h.queries.GetDeployment(r.Context(), deployID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "deployment not found")
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

	// Send persisted logs first — split by line since SSE data fields can't contain raw newlines
	if d.Logs != "" {
		for _, line := range strings.Split(d.Logs, "\n") {
			if line != "" {
				fmt.Fprintf(w, "data: %s\n\n", line)
			}
		}
		flusher.Flush()
	}

	// If deploy is already finished, send status and close
	if d.Status == "healthy" || d.Status == "failed" || d.Status == "rolled_back" {
		fmt.Fprintf(w, "event: done\ndata: %s\n\n", d.Status)
		flusher.Flush()
		return
	}

	// Subscribe to Redis pub/sub for live logs
	channel := fmt.Sprintf("deploy:%s", deployID)
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

// ListTargets handles GET /api/v1/apps/{appId}/deployments/{deployId}/targets
func (h *DeployHandler) ListTargets(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	deployID, err := uuid.Parse(r.PathValue("deployId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid deploy ID")
		return
	}

	targets, err := h.queries.ListDeploymentTargets(r.Context(), deployID)
	if err != nil {
		h.logger.Error("failed to list targets", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list targets")
		return
	}

	respond.JSON(w, http.StatusOK, targets)
}

// ContainerLogs handles GET /api/v1/apps/{appId}/logs (SSE)
// Query params: ?container=name (optional, defaults to latest), ?tail=N, ?follow=true
func (h *DeployHandler) ContainerLogs(w http.ResponseWriter, r *http.Request) {
	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}

	containerName := r.URL.Query().Get("container")
	agentID := ""

	if containerName == "" {
		// Find latest deployment's container by name pattern
		app, err := h.queries.GetApp(r.Context(), appID)
		if err != nil {
			respond.Error(w, http.StatusNotFound, "app not found")
			return
		}

		// Get deployments to find the latest one with targets
		deploys, err := h.queries.ListDeploymentsByApp(r.Context(), db.ListDeploymentsByAppParams{
			AppID: appID, Limit: 5, Offset: 0,
		})
		if err != nil || len(deploys) == 0 {
			respond.Error(w, http.StatusNotFound, "no deployments found")
			return
		}

		// Find the first deployment with targets that have an agent online
		for _, d := range deploys {
			targets, err := h.queries.ListDeploymentTargets(r.Context(), d.ID)
			if err != nil || len(targets) == 0 {
				continue
			}
			for _, t := range targets {
				sid := t.ServerID.String()
				if state := h.connMgr.GetState(sid); state != nil && state.Status == "online" {
					// Use deterministic container name: nixway-{slug}-{deploy-short}
					containerName = fmt.Sprintf("nixway-%s-%s", app.Slug, d.ID.String()[:8])
					agentID = sid
					break
				}
			}
			if agentID != "" {
				break
			}
		}
	} else {
		// Container specified — find which agent has it
		containers, err := h.queries.ListActiveContainersByApp(r.Context(), appID)
		if err == nil {
			for _, c := range containers {
				if c.AgentID != nil {
					agentID = *c.AgentID
					break
				}
			}
		}
	}

	if containerName == "" || agentID == "" {
		respond.Error(w, http.StatusNotFound, "no running containers found")
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

	requestID := uuid.New().String()
	channel := "container-logs:" + requestID
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	tail := int32(200)
	if t := r.URL.Query().Get("tail"); t != "" {
		if v, err := strconv.Atoi(t); err == nil && v > 0 {
			tail = int32(v)
		}
	}
	follow := r.URL.Query().Get("follow") != "false"

	err = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ContainerLogs{
			ContainerLogs: &agentv1.ContainerLogsCommand{
				RequestId:     requestID,
				ContainerName: containerName,
				Tail:          tail,
				Follow:        follow,
			},
		},
	})
	if err != nil {
		fmt.Fprintf(w, "data: ERROR: %s\n\n", err)
		fmt.Fprintf(w, "event: done\ndata: error\n\n")
		flusher.Flush()
		return
	}

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

// CleanupDeployments handles POST /api/v1/apps/{appId}/cleanup
// Removes old containers and optionally old deployment records.
func (h *DeployHandler) CleanupDeployments(w http.ResponseWriter, r *http.Request) {
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

	app, err := h.queries.GetApp(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	// Get all deployments, stop non-healthy containers
	deploys, err := h.queries.ListDeploymentsByApp(r.Context(), db.ListDeploymentsByAppParams{
		AppID: appID, Limit: 100, Offset: 0,
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list deployments")
		return
	}

	cleaned := 0
	for _, d := range deploys {
		if d.Status == "healthy" {
			continue // keep healthy deployment
		}
		targets, _ := h.queries.ListDeploymentTargets(r.Context(), d.ID)
		for _, t := range targets {
			if t.Status == "healthy" || t.Status == "stopped" {
				continue
			}
			// Try to stop container
			containerName := fmt.Sprintf("nixway-%s-%s", app.Slug, d.ID.String()[:8])
			agentID := t.ServerID.String()
			_ = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
				Payload: &agentv1.ControlMessage_StopContainer{
					StopContainer: &agentv1.StopContainerCommand{
						ContainerName:  containerName,
						TimeoutSeconds: 5,
					},
				},
			})
			cleaned++
		}
	}

	respond.JSON(w, http.StatusOK, map[string]any{
		"cleaned": cleaned,
		"message": fmt.Sprintf("Stopped %d stale containers", cleaned),
	})
}
