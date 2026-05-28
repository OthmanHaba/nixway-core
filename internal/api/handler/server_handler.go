package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/othmanhaba/nixway-core/internal/server"
	"github.com/redis/go-redis/v9"
)

type ServerHandler struct {
	queries    *db.Queries
	audit      *audit.Writer
	onboarding *server.OnboardingService
	connMgr    *agent.ConnManager
	redis      *redis.Client
	logger     *slog.Logger
}

func NewServerHandler(queries *db.Queries, auditWriter *audit.Writer, onboarding *server.OnboardingService, connMgr *agent.ConnManager, redisClient *redis.Client, logger *slog.Logger) *ServerHandler {
	return &ServerHandler{
		queries:    queries,
		audit:      auditWriter,
		onboarding: onboarding,
		connMgr:    connMgr,
		redis:      redisClient,
		logger:     logger,
	}
}

type createServerRequest struct {
	Name     string    `json:"name"`
	Hostname string    `json:"hostname"`
	PublicIP string    `json:"public_ip"`
	SSHPort  int32     `json:"ssh_port"`
	SSHUser  string    `json:"ssh_user"`
	SSHKeyID uuid.UUID `json:"ssh_key_id"`
}

func (h *ServerHandler) Create(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeServersWrite); !ok {
		return
	}

	var req createServerRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" || req.Hostname == "" || req.PublicIP == "" {
		respond.Error(w, http.StatusBadRequest, "name, hostname, and public_ip are required")
		return
	}
	if req.SSHPort == 0 {
		req.SSHPort = 22
	}
	if req.SSHUser == "" {
		req.SSHUser = "root"
	}

	result, err := h.onboarding.Onboard(r.Context(), server.OnboardRequest{
		TeamID:   teamID,
		Name:     req.Name,
		Hostname: req.Hostname,
		PublicIP: req.PublicIP,
		SSHPort:  req.SSHPort,
		SSHUser:  req.SSHUser,
		SSHKeyID: req.SSHKeyID,
	})
	if err != nil {
		h.logger.Error("server onboarding failed", "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "server.create",
		ResourceType: "server",
		ResourceID:   &result.Server.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, result.Server)
}

func (h *ServerHandler) List(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember, model.ScopeServersRead); !ok {
		return
	}

	servers, err := h.queries.ListServersByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list servers", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Optional tag filter: ?tag=key:value
	if tagFilter := r.URL.Query().Get("tag"); tagFilter != "" {
		parts := strings.SplitN(tagFilter, ":", 2)
		if len(parts) == 2 {
			filterKey, filterVal := parts[0], parts[1]
			var filtered []db.Server
			for _, s := range servers {
				tags, tagErr := h.queries.ListServerTags(r.Context(), s.ID)
				if tagErr != nil {
					continue
				}
				for _, t := range tags {
					if t.Key == filterKey && t.Value == filterVal {
						filtered = append(filtered, s)
						break
					}
				}
			}
			servers = filtered
		}
	}

	respond.JSON(w, http.StatusOK, servers)
}

type serverDetailResponse struct {
	db.Server
	Resources *db.ServerResource `json:"resources,omitempty"`
}

func (h *ServerHandler) Get(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember, model.ScopeServersRead); !ok {
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	srv, err := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	resp := serverDetailResponse{Server: srv}

	resources, err := h.queries.GetServerResources(r.Context(), serverID)
	if err == nil {
		resp.Resources = &resources
	}

	respond.JSON(w, http.StatusOK, resp)
}

type serverMetricsResponse struct {
	ServerID    uuid.UUID `json:"server_id"`
	CpuPercent  float64   `json:"cpu_percent"`
	MemoryTotal int64     `json:"memory_total"`
	MemoryUsed  int64     `json:"memory_used"`
	MemoryPct   float64   `json:"memory_percent"`
	UpdatedAt   time.Time `json:"updated_at"`
	Fresh       bool      `json:"fresh"`
}

// Metrics returns the latest agent-reported usage snapshot for a server.
// GET /api/v1/teams/{id}/servers/{serverId}/metrics
func (h *ServerHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember, model.ScopeServersRead); !ok {
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	// Make sure the server actually belongs to this team before we read metrics.
	if _, err := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	}); err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	m, err := h.queries.GetServerMetric(r.Context(), serverID)
	if err != nil {
		// No row yet (agent hasn't reported) — return an explicit "no data" body
		// rather than 404 so the UI can render an empty-state instead of an error.
		respond.JSON(w, http.StatusOK, serverMetricsResponse{ServerID: serverID})
		return
	}

	resp := serverMetricsResponse{
		ServerID:    m.ServerID,
		CpuPercent:  m.CpuPercent,
		MemoryTotal: m.MemoryTotal,
		MemoryUsed:  m.MemoryUsed,
		UpdatedAt:   m.UpdatedAt,
		// Agent reports every ~30s; treat samples older than 2 minutes as stale.
		Fresh: time.Since(m.UpdatedAt) < 2*time.Minute,
	}
	if m.MemoryTotal > 0 {
		resp.MemoryPct = (float64(m.MemoryUsed) / float64(m.MemoryTotal)) * 100
	}

	respond.JSON(w, http.StatusOK, resp)
}

type updateServerRequest struct {
	Name string `json:"name"`
}

func (h *ServerHandler) Update(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeServersWrite); !ok {
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	var req updateServerRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	srv, err := h.queries.UpdateServerName(r.Context(), db.UpdateServerNameParams{
		ID:     serverID,
		TeamID: teamID,
		Name:   req.Name,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "server.update",
		ResourceType: "server",
		ResourceID:   &serverID,
		IPAddress:    ip,
		Metadata:     map[string]string{"name": req.Name},
	})

	respond.JSON(w, http.StatusOK, srv)
}

type setServerRoleRequest struct {
	Role string `json:"role"`
}

// SetRole handles PUT /api/v1/teams/{id}/servers/{serverId}/role.
// role must be one of: worker, edge, both. Workers run app/db containers,
// edge nodes front the cluster with Traefik, both does both (small clusters).
func (h *ServerHandler) SetRole(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeServersWrite); !ok {
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	var req setServerRoleRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	switch req.Role {
	case "worker", "edge", "both":
	default:
		respond.Error(w, http.StatusBadRequest, "role must be one of: worker, edge, both")
		return
	}

	srv, err := h.queries.UpdateServerRole(r.Context(), db.UpdateServerRoleParams{
		ID:     serverID,
		TeamID: teamID,
		Role:   req.Role,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "server.set_role",
		ResourceType: "server",
		ResourceID:   &serverID,
		IPAddress:    ip,
		Metadata:     map[string]string{"role": req.Role},
	})

	respond.JSON(w, http.StatusOK, srv)
}

func (h *ServerHandler) Delete(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeServersWrite); !ok {
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	err = h.queries.DeleteServer(r.Context(), db.DeleteServerParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		h.logger.Error("failed to delete server", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete server")
		return
	}
	_ = h.queries.DeleteMetricSamplesForScope(r.Context(), db.DeleteMetricSamplesForScopeParams{
		ScopeType: "server",
		ScopeID:   serverID,
	})

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "server.delete",
		ResourceType: "server",
		ResourceID:   &serverID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type cleanupServerRequest struct {
	RemoveStoppedContainers bool  `json:"remove_stopped_containers"`
	RemoveUnusedImages      bool  `json:"remove_unused_images"`
	RemoveUnusedNetworks    bool  `json:"remove_unused_networks"`
	RemoveBuildCache        bool  `json:"remove_build_cache"`
	RemoveVolumes           bool  `json:"remove_volumes"`
	OlderThanHours          int32 `json:"older_than_hours"`
}

func (req cleanupServerRequest) hasSelection() bool {
	return req.RemoveStoppedContainers ||
		req.RemoveUnusedImages ||
		req.RemoveUnusedNetworks ||
		req.RemoveBuildCache ||
		req.RemoveVolumes
}

// Cleanup handles POST /api/v1/teams/{id}/servers/{serverId}/cleanup.
func (h *ServerHandler) Cleanup(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeServersWrite); !ok {
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	var req cleanupServerRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !req.hasSelection() {
		respond.Error(w, http.StatusBadRequest, "select at least one cleanup option")
		return
	}
	if req.OlderThanHours < 0 {
		respond.Error(w, http.StatusBadRequest, "older_than_hours cannot be negative")
		return
	}

	srv, err := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	agentID := serverID.String()
	if srv.AgentID != nil && *srv.AgentID != "" {
		agentID = *srv.AgentID
	}
	if state := h.connMgr.GetState(agentID); state == nil || state.Status != "online" {
		respond.Error(w, http.StatusNotFound, "server agent not online")
		return
	}
	if h.redis == nil {
		respond.Error(w, http.StatusInternalServerError, "cleanup result bus unavailable")
		return
	}

	requestID := uuid.New().String()
	channel := "server-cleanup:" + requestID
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	if err := h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ServerCleanup{
			ServerCleanup: &agentv1.ServerCleanupCommand{
				RequestId:               requestID,
				RemoveStoppedContainers: req.RemoveStoppedContainers,
				RemoveUnusedImages:      req.RemoveUnusedImages,
				RemoveUnusedNetworks:    req.RemoveUnusedNetworks,
				RemoveBuildCache:        req.RemoveBuildCache,
				RemoveVolumes:           req.RemoveVolumes,
				OlderThanHours:          req.OlderThanHours,
			},
		},
	}); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to send cleanup command")
		return
	}

	ch := sub.Channel()
	select {
	case msg := <-ch:
		var result agentv1.ServerCleanupResult
		if err := json.Unmarshal([]byte(msg.Payload), &result); err != nil {
			respond.Error(w, http.StatusInternalServerError, "failed to parse cleanup result")
			return
		}
		if !result.Success {
			respond.Error(w, http.StatusInternalServerError, result.Error)
			return
		}

		ip := parseIP(r)
		_ = h.audit.Log(r.Context(), audit.Entry{
			TeamID:       &teamID,
			ActorID:      &authCtx.UserID,
			ActorType:    "user",
			Action:       "server.cleanup",
			ResourceType: "server",
			ResourceID:   &serverID,
			IPAddress:    ip,
		})

		respond.JSON(w, http.StatusOK, &result)
	case <-time.After(60 * time.Second):
		respond.Error(w, http.StatusGatewayTimeout, "cleanup timed out")
	case <-r.Context().Done():
		return
	}
}
