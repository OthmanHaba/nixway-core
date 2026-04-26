package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/containerlog"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/deploy"
	"github.com/othmanhaba/nixway-core/internal/scheduler"
	"github.com/redis/go-redis/v9"
)

type DeployHandler struct {
	queries      *db.Queries
	deploySvc    *deploy.Service
	connMgr      *agent.ConnManager
	redis        *redis.Client
	containerLog *containerlog.Service
	logger       *slog.Logger
}

func NewDeployHandler(queries *db.Queries, deploySvc *deploy.Service, connMgr *agent.ConnManager, redisClient *redis.Client, containerLogSvc *containerlog.Service, logger *slog.Logger) *DeployHandler {
	return &DeployHandler{
		queries:      queries,
		deploySvc:    deploySvc,
		connMgr:      connMgr,
		redis:        redisClient,
		containerLog: containerLogSvc,
		logger:       logger,
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

type scaleAppRequest struct {
	Replicas             int32                 `json:"replicas"`
	PlacementStrategy    string                `json:"placement_strategy"`
	PlacementConstraints scheduler.Constraints `json:"placement_constraints"`
	PinnedServerIDs      []string              `json:"pinned_server_ids"`
}

// ScaleApp handles POST /api/v1/apps/{appId}/scale.
func (h *DeployHandler) ScaleApp(w http.ResponseWriter, r *http.Request) {
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

	var req scaleAppRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Replicas <= 0 {
		respond.Error(w, http.StatusBadRequest, "replicas must be greater than zero")
		return
	}
	if req.PlacementStrategy == "" {
		req.PlacementStrategy = app.PlacementStrategy
	}
	constraints := scheduler.ParseConstraints(app.PlacementConstraints)
	if req.PlacementConstraints.MustHave != nil || req.PlacementConstraints.MustNotHave != nil {
		constraints = req.PlacementConstraints
	}
	pinnedServerIDs := app.PinnedServerIds
	if req.PinnedServerIDs != nil {
		pinnedServerIDs, err = parseUUIDStrings(req.PinnedServerIDs)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid pinned_server_ids")
			return
		}
	}

	result, err := h.deploySvc.ScaleApp(r.Context(), appID, deploy.ScaleRequest{
		Replicas:             req.Replicas,
		PlacementStrategy:    req.PlacementStrategy,
		PlacementConstraints: constraints,
		PinnedServerIDs:      pinnedServerIDs,
		ActorID:              &authCtx.UserID,
		ActorType:            "user",
	})
	if err != nil {
		h.logger.Error("failed to scale app", "error", err)
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	respond.JSON(w, http.StatusAccepted, result)
}

// ListScalingEvents handles GET /api/v1/apps/{appId}/scaling-events.
func (h *DeployHandler) ListScalingEvents(w http.ResponseWriter, r *http.Request) {
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

	events, err := h.queries.ListScalingEventsByApp(r.Context(), db.ListScalingEventsByAppParams{
		AppID:  appID,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list scaling events")
		return
	}
	respond.JSON(w, http.StatusOK, events)
}

type createAutoscalingRuleRequest struct {
	Name                string  `json:"name"`
	MetricName          string  `json:"metric_name"`
	Comparison          string  `json:"comparison"`
	Threshold           float64 `json:"threshold"`
	DurationSeconds     int32   `json:"duration_seconds"`
	ActionType          string  `json:"action_type"`
	ActionValue         int32   `json:"action_value"`
	MinReplicas         int32   `json:"min_replicas"`
	MaxReplicas         int32   `json:"max_replicas"`
	CooldownUpSeconds   int32   `json:"cooldown_up_seconds"`
	CooldownDownSeconds int32   `json:"cooldown_down_seconds"`
	Enabled             *bool   `json:"enabled"`
}

func (h *DeployHandler) CreateAutoscalingRule(w http.ResponseWriter, r *http.Request) {
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
	var req createAutoscalingRuleRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		req.Name = "CPU autoscale"
	}
	if req.MetricName == "" {
		req.MetricName = "cpu_percent"
	}
	if req.Comparison == "" {
		req.Comparison = "gt"
	}
	if req.DurationSeconds == 0 {
		req.DurationSeconds = 120
	}
	if req.ActionType == "" {
		req.ActionType = "scale_by"
	}
	if req.ActionValue == 0 {
		req.ActionValue = 1
	}
	if req.MinReplicas == 0 {
		req.MinReplicas = 1
	}
	if req.MaxReplicas == 0 {
		req.MaxReplicas = 10
	}
	if req.CooldownUpSeconds == 0 {
		req.CooldownUpSeconds = 60
	}
	if req.CooldownDownSeconds == 0 {
		req.CooldownDownSeconds = 300
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	rule, err := h.queries.CreateAutoscalingRule(r.Context(), db.CreateAutoscalingRuleParams{
		AppID:               appID,
		Name:                req.Name,
		MetricName:          req.MetricName,
		Comparison:          req.Comparison,
		Threshold:           req.Threshold,
		DurationSeconds:     req.DurationSeconds,
		ActionType:          req.ActionType,
		ActionValue:         req.ActionValue,
		MinReplicas:         req.MinReplicas,
		MaxReplicas:         req.MaxReplicas,
		CooldownUpSeconds:   req.CooldownUpSeconds,
		CooldownDownSeconds: req.CooldownDownSeconds,
		Enabled:             enabled,
	})
	if err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, rule)
}

func (h *DeployHandler) ListAutoscalingRules(w http.ResponseWriter, r *http.Request) {
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
	rules, err := h.queries.ListAutoscalingRulesByApp(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list autoscaling rules")
		return
	}
	respond.JSON(w, http.StatusOK, rules)
}

func (h *DeployHandler) DeleteAutoscalingRule(w http.ResponseWriter, r *http.Request) {
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
	ruleID, err := uuid.Parse(r.PathValue("ruleId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid rule ID")
		return
	}
	if err := h.queries.DeleteAutoscalingRule(r.Context(), db.DeleteAutoscalingRuleParams{ID: ruleID, AppID: appID}); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to delete autoscaling rule")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DeployHandler) EvaluateAutoscaling(w http.ResponseWriter, r *http.Request) {
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
	results, err := h.deploySvc.EvaluateAutoscaling(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, results)
}

func (h *DeployHandler) GetTraffic(w http.ResponseWriter, r *http.Request) {
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
	view, err := h.deploySvc.GetTraffic(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, view)
}

func (h *DeployHandler) UpdateTraffic(w http.ResponseWriter, r *http.Request) {
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
		Weights []struct {
			BackendID string `json:"backend_id"`
			Weight    int32  `json:"weight"`
		} `json:"weights"`
	}
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	weights := make([]deploy.TrafficWeight, 0, len(req.Weights))
	for _, item := range req.Weights {
		id, err := uuid.Parse(item.BackendID)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid backend_id")
			return
		}
		weights = append(weights, deploy.TrafficWeight{BackendID: id, Weight: item.Weight})
	}
	view, err := h.deploySvc.UpdateTrafficWeights(r.Context(), appID, weights, &authCtx.UserID, "user")
	if err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, view)
}

func (h *DeployHandler) PromoteTrafficBackend(w http.ResponseWriter, r *http.Request) {
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
	backendID, err := uuid.Parse(r.PathValue("backendId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid backend ID")
		return
	}
	view, err := h.deploySvc.PromoteTrafficBackend(r.Context(), appID, backendID, &authCtx.UserID)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, view)
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
	var serverID uuid.UUID
	var deploymentID *uuid.UUID

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
					serverID = t.ServerID
					depID := d.ID
					deploymentID = &depID
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
				if c.AgentID != nil && c.ContainerID != nil && *c.ContainerID == containerName {
					agentID = *c.AgentID
					serverID = c.ServerID
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
			if h.containerLog != nil && serverID != uuid.Nil {
				for _, line := range strings.Split(strings.TrimSuffix(msg.Payload, "\n"), "\n") {
					if line == "" {
						continue
					}
					h.containerLog.Ingest(r.Context(), appID, serverID, deploymentID, containerName, 0, line, "stdout", time.Now())
				}
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

// ListReplicas handles GET /api/v1/apps/{appId}/replicas
func (h *DeployHandler) ListReplicas(w http.ResponseWriter, r *http.Request) {
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

	containers, err := h.queries.ListActiveContainersByApp(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list replicas")
		return
	}

	respond.JSON(w, http.StatusOK, containers)
}

// RestartContainer handles POST /api/v1/apps/{appId}/containers/{containerName}/restart
func (h *DeployHandler) RestartContainer(w http.ResponseWriter, r *http.Request) {
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

	containerName := r.PathValue("containerName")
	if containerName == "" {
		respond.Error(w, http.StatusBadRequest, "container name required")
		return
	}

	// Find which agent has this container
	agentID := h.findAgentForApp(r, appID)
	if agentID == "" {
		respond.Error(w, http.StatusNotFound, "no online agent found for this app")
		return
	}

	err = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_RestartContainer{
			RestartContainer: &agentv1.RestartContainerCommand{
				ContainerName:  containerName,
				TimeoutSeconds: 10,
			},
		},
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to send restart command")
		return
	}

	respond.JSON(w, http.StatusOK, map[string]string{"status": "restarting", "container": containerName})
}

// StopContainer handles POST /api/v1/apps/{appId}/containers/{containerName}/stop
func (h *DeployHandler) StopContainer(w http.ResponseWriter, r *http.Request) {
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

	containerName := r.PathValue("containerName")
	if containerName == "" {
		respond.Error(w, http.StatusBadRequest, "container name required")
		return
	}

	agentID := h.findAgentForApp(r, appID)
	if agentID == "" {
		respond.Error(w, http.StatusNotFound, "no online agent found for this app")
		return
	}

	app, _ := h.queries.GetApp(r.Context(), appID)

	err = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_StopContainer{
			StopContainer: &agentv1.StopContainerCommand{
				ContainerName:  containerName,
				TimeoutSeconds: 10,
				RemoveTraefik:  true,
				AppSlug:        app.Slug,
			},
		},
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to send stop command")
		return
	}

	respond.JSON(w, http.StatusOK, map[string]string{"status": "stopping", "container": containerName})
}

// InspectContainer handles GET /api/v1/apps/{appId}/containers/{containerName}/inspect
func (h *DeployHandler) InspectContainer(w http.ResponseWriter, r *http.Request) {
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

	containerName := r.PathValue("containerName")
	if containerName == "" {
		respond.Error(w, http.StatusBadRequest, "container name required")
		return
	}

	agentID := h.findAgentForApp(r, appID)
	if agentID == "" {
		respond.Error(w, http.StatusNotFound, "no online agent found for this app")
		return
	}

	requestID := uuid.New().String()
	channel := "inspect:" + requestID
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	err = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ContainerInspect{
			ContainerInspect: &agentv1.ContainerInspectCommand{
				RequestId:     requestID,
				ContainerName: containerName,
			},
		},
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to send inspect command")
		return
	}

	// Wait for result with timeout
	ch := sub.Channel()
	select {
	case msg := <-ch:
		var result agentv1.ContainerInspectResult
		if err := json.Unmarshal([]byte(msg.Payload), &result); err != nil {
			respond.Error(w, http.StatusInternalServerError, "failed to parse inspect result")
			return
		}
		if !result.Success {
			respond.Error(w, http.StatusInternalServerError, result.Error)
			return
		}
		respond.JSON(w, http.StatusOK, &result)
	case <-time.After(15 * time.Second):
		respond.Error(w, http.StatusGatewayTimeout, "inspect timed out")
	case <-r.Context().Done():
		return
	}
}

// SearchLogs handles GET /api/v1/apps/{appId}/logs/search
func (h *DeployHandler) SearchLogs(w http.ResponseWriter, r *http.Request) {
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

	query := r.URL.Query().Get("q")
	if query == "" {
		respond.Error(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	since := time.Now().AddDate(0, 0, -7) // default: last 7 days
	if s := r.URL.Query().Get("since"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			since = t
		}
	}
	until := time.Now()
	if u := r.URL.Query().Get("until"); u != "" {
		if t, err := time.Parse(time.RFC3339, u); err == nil {
			until = t
		}
	}

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 1000 {
			limit = v
		}
	}

	results, err := h.containerLog.Search(r.Context(), appID, query, since, until, limit)
	if err != nil {
		h.logger.Error("log search failed", "error", err)
		respond.Error(w, http.StatusInternalServerError, "search failed")
		return
	}

	respond.JSON(w, http.StatusOK, results)
}

// HistoricalLogs handles GET /api/v1/apps/{appId}/logs/history
func (h *DeployHandler) HistoricalLogs(w http.ResponseWriter, r *http.Request) {
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

	lines := 500
	if l := r.URL.Query().Get("lines"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 5000 {
			lines = v
		}
	}

	results, err := h.containerLog.Tail(r.Context(), appID, lines)
	if err != nil {
		h.logger.Error("historical logs failed", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to fetch logs")
		return
	}

	respond.JSON(w, http.StatusOK, results)
}

// ServerLogs handles GET /api/v1/teams/{id}/servers/{serverId}/logs (SSE)
func (h *DeployHandler) ServerLogs(w http.ResponseWriter, r *http.Request) {
	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	agentID := serverID.String()
	if state := h.connMgr.GetState(agentID); state == nil || state.Status != "online" {
		respond.Error(w, http.StatusNotFound, "server agent not online")
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
	channel := "server-logs:" + requestID
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	unit := r.URL.Query().Get("unit")
	tail := int32(200)
	if t := r.URL.Query().Get("tail"); t != "" {
		if v, err := strconv.Atoi(t); err == nil && v > 0 {
			tail = int32(v)
		}
	}
	follow := r.URL.Query().Get("follow") != "false"

	err = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ServerLogs{
			ServerLogs: &agentv1.ServerLogsCommand{
				RequestId: requestID,
				Unit:      unit,
				Tail:      tail,
				Follow:    follow,
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

// findAgentForApp finds an online agent for the given app's active containers.
func (h *DeployHandler) findAgentForApp(r *http.Request, appID uuid.UUID) string {
	containers, err := h.queries.ListActiveContainersByApp(r.Context(), appID)
	if err != nil || len(containers) == 0 {
		return ""
	}
	for _, c := range containers {
		if c.AgentID != nil {
			agentID := *c.AgentID
			if state := h.connMgr.GetState(agentID); state != nil && state.Status == "online" {
				return agentID
			}
		}
	}
	return ""
}

func parseUUIDStrings(values []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
