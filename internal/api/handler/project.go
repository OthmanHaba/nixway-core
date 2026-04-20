package handler

import (
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/project"
)

type ProjectHandler struct {
	queries    *db.Queries
	audit      *audit.Writer
	projectSvc *project.Service
	logger     *slog.Logger
}

func NewProjectHandler(queries *db.Queries, auditWriter *audit.Writer, projectSvc *project.Service, logger *slog.Logger) *ProjectHandler {
	return &ProjectHandler{
		queries:    queries,
		audit:      auditWriter,
		projectSvc: projectSvc,
		logger:     logger,
	}
}

type createProjectRequest struct {
	ClusterID   string `json:"cluster_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Create handles POST /api/v1/teams/{teamId}/projects
func (h *ProjectHandler) Create(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("teamId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	var req createProjectRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	clusterID, err := uuid.Parse(req.ClusterID)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}

	// Verify cluster belongs to this team
	_, err = h.queries.GetClusterByID(r.Context(), db.GetClusterByIDParams{
		ID:     clusterID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "cluster not found or does not belong to this team")
		return
	}

	p, err := h.projectSvc.Create(r.Context(), project.CreateParams{
		TeamID:      teamID,
		ClusterID:   clusterID,
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		h.logger.Error("failed to create project", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create project")
		return
	}

	respond.JSON(w, http.StatusCreated, p)
}

// List handles GET /api/v1/teams/{teamId}/projects
func (h *ProjectHandler) List(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("teamId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	projects, err := h.projectSvc.List(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list projects", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list projects")
		return
	}

	respond.JSON(w, http.StatusOK, projects)
}

// Get handles GET /api/v1/teams/{teamId}/projects/{projectId}
func (h *ProjectHandler) Get(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}

	p, err := h.projectSvc.Get(r.Context(), projectID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "project not found")
		return
	}

	respond.JSON(w, http.StatusOK, p)
}

type updateProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

// Update handles PUT /api/v1/teams/{teamId}/projects/{projectId}
func (h *ProjectHandler) Update(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}

	var req updateProjectRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Status == "" {
		req.Status = "active"
	}

	p, err := h.projectSvc.Update(r.Context(), projectID, req.Name, req.Description, req.Status)
	if err != nil {
		h.logger.Error("failed to update project", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to update project")
		return
	}

	respond.JSON(w, http.StatusOK, p)
}

// Delete handles DELETE /api/v1/teams/{teamId}/projects/{projectId}
func (h *ProjectHandler) Delete(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}

	if err := h.projectSvc.Delete(r.Context(), projectID); err != nil {
		h.logger.Error("failed to delete project", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete project")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type createEnvironmentRequest struct {
	Name string `json:"name"`
}

// CreateEnvironment handles POST /api/v1/projects/{projectId}/environments
func (h *ProjectHandler) CreateEnvironment(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}

	var req createEnvironmentRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	env, err := h.projectSvc.CreateEnvironment(r.Context(), projectID, req.Name)
	if err != nil {
		h.logger.Error("failed to create environment", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create environment")
		return
	}

	respond.JSON(w, http.StatusCreated, env)
}

// ListEnvironments handles GET /api/v1/projects/{projectId}/environments
func (h *ProjectHandler) ListEnvironments(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}

	envs, err := h.projectSvc.ListEnvironments(r.Context(), projectID)
	if err != nil {
		h.logger.Error("failed to list environments", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list environments")
		return
	}

	respond.JSON(w, http.StatusOK, envs)
}
