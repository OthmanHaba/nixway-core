package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/server"
)

type ServerHandler struct {
	queries    *db.Queries
	audit      *audit.Writer
	onboarding *server.OnboardingService
	logger     *slog.Logger
}

func NewServerHandler(queries *db.Queries, auditWriter *audit.Writer, onboarding *server.OnboardingService, logger *slog.Logger) *ServerHandler {
	return &ServerHandler{
		queries:    queries,
		audit:      auditWriter,
		onboarding: onboarding,
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
		PublicIP:  req.PublicIP,
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
	Server    db.Server          `json:"server"`
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

	// Verify server belongs to team
	_, err = h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	// No UpdateServerName query exists in sqlc, so we return the current server.
	// Name updates would require adding an sqlc query. For now, respond with not implemented.
	respond.Error(w, http.StatusNotImplemented, "server name update not yet supported — add UpdateServerName sqlc query")
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
