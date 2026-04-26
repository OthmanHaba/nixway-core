package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/cluster"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/redis/go-redis/v9"
)

type ScrapeConfigSyncer interface {
	SyncClusterScrapeConfig(ctx context.Context, clusterID uuid.UUID) (string, error)
	SyncTeamScrapeConfig(ctx context.Context, teamID uuid.UUID) (string, error)
}

// ClusterHandler handles cluster CRUD and member management.
type ClusterHandler struct {
	queries       *db.Queries
	audit         *audit.Writer
	clusterSvc    *cluster.Service
	meshMgr       *mesh.Manager
	redis         *redis.Client
	observability ScrapeConfigSyncer
	logger        *slog.Logger
}

func NewClusterHandler(queries *db.Queries, auditWriter *audit.Writer, clusterSvc *cluster.Service, meshMgr *mesh.Manager, redisClient *redis.Client, observability ScrapeConfigSyncer, logger *slog.Logger) *ClusterHandler {
	return &ClusterHandler{
		queries:       queries,
		audit:         auditWriter,
		clusterSvc:    clusterSvc,
		meshMgr:       meshMgr,
		redis:         redisClient,
		observability: observability,
		logger:        logger,
	}
}

func (h *ClusterHandler) syncScrapeConfig(clusterID uuid.UUID) {
	if h.observability == nil {
		return
	}
	go func() {
		if _, err := h.observability.SyncClusterScrapeConfig(context.Background(), clusterID); err != nil {
			h.logger.Warn("failed to sync vmagent scrape config", "cluster_id", clusterID, "error", err)
		}
	}()
}

func (h *ClusterHandler) syncTeamScrapeConfig(teamID uuid.UUID) {
	if h.observability == nil {
		return
	}
	go func() {
		if _, err := h.observability.SyncTeamScrapeConfig(context.Background(), teamID); err != nil {
			h.logger.Warn("failed to sync vmagent team scrape config", "team_id", teamID, "error", err)
		}
	}()
}

type createClusterRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Region      string `json:"region"`
}

func (h *ClusterHandler) Create(w http.ResponseWriter, r *http.Request) {
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

	var req createClusterRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	c, err := h.clusterSvc.CreateCluster(r.Context(), cluster.CreateClusterRequest{
		TeamID:      teamID,
		Name:        req.Name,
		Description: req.Description,
		Region:      req.Region,
	})
	if err != nil {
		h.logger.Error("failed to create cluster", "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "cluster.create",
		ResourceType: "cluster",
		ResourceID:   &c.ID,
		IPAddress:    ip,
	})

	h.syncTeamScrapeConfig(teamID)

	respond.JSON(w, http.StatusCreated, c)
}

func (h *ClusterHandler) List(w http.ResponseWriter, r *http.Request) {
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

	clusters, err := h.queries.ListClustersByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list clusters", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respond.JSON(w, http.StatusOK, clusters)
}

type clusterDetailResponse struct {
	db.Cluster
	MemberCount int64 `json:"member_count"`
}

func (h *ClusterHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	c, err := h.queries.GetClusterByID(r.Context(), db.GetClusterByIDParams{
		ID:     clusterID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "cluster not found")
		return
	}

	count, err := h.queries.CountClusterMembers(r.Context(), clusterID)
	if err != nil {
		count = 0
	}

	respond.JSON(w, http.StatusOK, clusterDetailResponse{
		Cluster:     c,
		MemberCount: count,
	})
}

type updateClusterRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Region      string `json:"region"`
}

func (h *ClusterHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	var req updateClusterRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	updated, err := h.queries.UpdateCluster(r.Context(), db.UpdateClusterParams{
		ID:          clusterID,
		TeamID:      teamID,
		Name:        req.Name,
		Description: req.Description,
		Region:      req.Region,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "cluster not found")
		return
	}

	respond.JSON(w, http.StatusOK, updated)
}

func (h *ClusterHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	err = h.queries.DeleteCluster(r.Context(), db.DeleteClusterParams{
		ID:     clusterID,
		TeamID: teamID,
	})
	if err != nil {
		h.logger.Error("failed to delete cluster", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete cluster")
		return
	}
	_ = h.queries.DeleteMetricSamplesForScope(r.Context(), db.DeleteMetricSamplesForScopeParams{
		ScopeType: "cluster",
		ScopeID:   clusterID,
	})

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "cluster.delete",
		ResourceType: "cluster",
		ResourceID:   &clusterID,
		IPAddress:    ip,
	})

	h.syncTeamScrapeConfig(teamID)

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListMembers lists all members of a cluster.
func (h *ClusterHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	members, err := h.queries.ListClusterMembers(r.Context(), clusterID)
	if err != nil {
		h.logger.Error("failed to list cluster members", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respond.JSON(w, http.StatusOK, members)
}

type addMemberRequest struct {
	ServerID uuid.UUID `json:"server_id"`
}

// AddMember adds a server to a cluster.
func (h *ClusterHandler) AddMember(w http.ResponseWriter, r *http.Request) {
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

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	var req addMemberRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ServerID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "server_id is required")
		return
	}

	member, err := h.clusterSvc.AddMember(r.Context(), cluster.AddMemberRequest{
		ClusterID: clusterID,
		ServerID:  req.ServerID,
		TeamID:    teamID,
	})
	if err != nil {
		h.logger.Error("failed to add member", "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	// Trigger WireGuard keygen on the new member's agent.
	// The agent will generate a keypair and send back the public key.
	// When the control plane receives the key, it triggers mesh regeneration.
	srv, _ := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{ID: req.ServerID, TeamID: teamID})
	if srv.AgentID != nil {
		h.meshMgr.RequestKeyGen(*srv.AgentID, member.ID.String(), int(member.ListenPort))
		h.logger.Info("sent keygen command to agent", "agent_id", *srv.AgentID, "member_id", member.ID)
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "cluster.add_member",
		ResourceType: "cluster_member",
		ResourceID:   &member.ID,
		IPAddress:    ip,
	})

	h.syncScrapeConfig(clusterID)

	respond.JSON(w, http.StatusCreated, member)
}

// RemoveMember removes a server from a cluster.
func (h *ClusterHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
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

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	// Get agent ID before removing so we can send teardown
	srv, _ := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{ID: serverID, TeamID: teamID})
	member, _ := h.queries.GetClusterMemberByServerID(r.Context(), serverID)

	if err := h.clusterSvc.RemoveMember(r.Context(), clusterID, serverID); err != nil {
		h.logger.Error("failed to remove member", "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	// Teardown WireGuard on the removed server
	if srv.AgentID != nil {
		h.meshMgr.TeardownMember(r.Context(), clusterID, *srv.AgentID, member.ID.String(), srv.Name)
	}

	// Regenerate mesh for remaining members
	go func() {
		bgCtx := context.Background()
		if err := h.meshMgr.RegenerateMesh(bgCtx, clusterID); err != nil {
			h.logger.Error("failed to regenerate mesh after remove", "error", err)
		}
	}()

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "cluster.remove_member",
		ResourceType: "cluster",
		ResourceID:   &clusterID,
		IPAddress:    ip,
	})

	h.syncScrapeConfig(clusterID)

	respond.JSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

// MeshHealth returns the N x N peer health matrix for a cluster.
func (h *ClusterHandler) MeshHealth(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	peers, err := h.queries.ListPeersByCluster(r.Context(), clusterID)
	if err != nil {
		h.logger.Error("failed to list peers", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respond.JSON(w, http.StatusOK, peers)
}

// ListEvents returns mesh events for a cluster.
func (h *ClusterHandler) ListEvents(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	events, err := h.queries.ListMeshEvents(r.Context(), db.ListMeshEventsParams{
		ClusterID: clusterID,
		Limit:     50,
		Offset:    0,
	})
	if err != nil {
		h.logger.Error("failed to list mesh events", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respond.JSON(w, http.StatusOK, events)
}

// RegenerateMesh manually triggers mesh regeneration for a cluster.
// POST /api/v1/teams/{id}/clusters/{clusterId}/mesh/regenerate
func (h *ClusterHandler) RegenerateMesh(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	// Use a background context — r.Context() is cancelled when the response is sent
	go func() {
		bgCtx := context.Background()
		if err := h.meshMgr.RegenerateMesh(bgCtx, clusterID); err != nil {
			h.logger.Error("manual mesh regeneration failed", "cluster_id", clusterID, "error", err)
		}
	}()

	respond.JSON(w, http.StatusOK, map[string]string{"status": "regeneration_started"})
}

// StreamMeshLogs streams real-time mesh operation logs via SSE.
// GET /api/v1/teams/{id}/clusters/{clusterId}/mesh/logs
func (h *ClusterHandler) StreamMeshLogs(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)

	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")

	channel := "mesh:" + clusterID.String()
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()
	ch := sub.Channel()

	// Send initial connected event
	fmt.Fprintf(w, "data: {\"event\":\"connected\",\"message\":\"Listening for mesh operations...\"}\n\n")
	_ = rc.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
			_ = rc.Flush()
		}
	}
}
