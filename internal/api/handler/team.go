package handler

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/othmanhaba/nixway-core/internal/model"
)

type TeamHandler struct {
	queries *db.Queries
	email   email.Sender
	audit   *audit.Writer
	config  *config.Config
	logger  *slog.Logger
}

func NewTeamHandler(
	queries *db.Queries,
	emailSender email.Sender,
	auditWriter *audit.Writer,
	cfg *config.Config,
	logger *slog.Logger,
) *TeamHandler {
	return &TeamHandler{
		queries: queries,
		email:   emailSender,
		audit:   auditWriter,
		config:  cfg,
		logger:  logger,
	}
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "team"
	}
	return s
}

type createTeamRequest struct {
	Name string `json:"name"`
}

func (h *TeamHandler) Create(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if authCtx.TokenID != nil {
		respond.Error(w, http.StatusForbidden, "api tokens cannot create teams")
		return
	}

	var req createTeamRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	slug := slugify(req.Name)
	team, err := h.queries.CreateTeam(r.Context(), db.CreateTeamParams{
		Name: req.Name,
		Slug: slug,
	})
	if err != nil {
		respond.Error(w, http.StatusConflict, "team slug already exists")
		return
	}

	// Add creator as owner
	_, err = h.queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		TeamID: team.ID,
		UserID: authCtx.UserID,
		Role:   string(model.RoleOwner),
	})
	if err != nil {
		h.logger.Error("failed to create owner membership", "error", err)
		// Clean up the team
		_ = h.queries.DeleteTeam(r.Context(), team.ID)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &team.ID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "team.create",
		ResourceType: "team",
		ResourceID:   &team.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, model.Team{
		ID:        team.ID,
		Name:      team.Name,
		Slug:      team.Slug,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	})
}

func (h *TeamHandler) List(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teams, err := h.queries.ListTeamsByUser(r.Context(), authCtx.UserID)
	if err != nil {
		h.logger.Error("failed to list teams", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if authCtx.TokenID != nil && authCtx.TeamID != nil {
		filtered := teams[:0]
		for _, t := range teams {
			if t.ID == *authCtx.TeamID {
				filtered = append(filtered, t)
				break
			}
		}
		teams = filtered
	}

	result := make([]model.Team, len(teams))
	for i, t := range teams {
		result[i] = model.Team{
			ID:        t.ID,
			Name:      t.Name,
			Slug:      t.Slug,
			CreatedAt: t.CreatedAt,
			UpdatedAt: t.UpdatedAt,
		}
	}

	respond.JSON(w, http.StatusOK, result)
}

func (h *TeamHandler) Get(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember, model.ScopeTeamsRead); !ok {
		return
	}

	team, err := h.queries.GetTeamByID(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "team not found")
		return
	}

	respond.JSON(w, http.StatusOK, model.Team{
		ID:        team.ID,
		Name:      team.Name,
		Slug:      team.Slug,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	})
}

type updateTeamRequest struct {
	Name string `json:"name"`
}

func (h *TeamHandler) Update(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeTeamsWrite); !ok {
		return
	}

	var req updateTeamRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	slug := slugify(req.Name)
	team, err := h.queries.UpdateTeam(r.Context(), db.UpdateTeamParams{
		ID:   teamID,
		Name: req.Name,
		Slug: slug,
	})
	if err != nil {
		respond.Error(w, http.StatusConflict, "team slug already exists")
		return
	}

	authCtx := middleware.GetAuthContext(r)
	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &team.ID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "team.update",
		ResourceType: "team",
		ResourceID:   &team.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, model.Team{
		ID:        team.ID,
		Name:      team.Name,
		Slug:      team.Slug,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	})
}

func (h *TeamHandler) Delete(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleOwner, model.ScopeTeamsWrite); !ok {
		return
	}

	if err := h.queries.DeleteTeam(r.Context(), teamID); err != nil {
		h.logger.Error("failed to delete team", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	authCtx := middleware.GetAuthContext(r)
	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "team.delete",
		ResourceType: "team",
		ResourceID:   &teamID,
		IPAddress:    ip,
	})

	w.WriteHeader(http.StatusNoContent)
}

// parseTeamID extracts and validates the team UUID from the URL path.
// Expected path pattern: /api/v1/teams/{id}...
func parseTeamID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	idStr := r.PathValue("id")
	if idStr == "" {
		respond.Error(w, http.StatusBadRequest, "missing team id")
		return uuid.UUID{}, false
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team id")
		return uuid.UUID{}, false
	}
	return id, true
}
