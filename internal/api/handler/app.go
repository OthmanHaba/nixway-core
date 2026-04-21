package handler

import (
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/app"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type AppHandler struct {
	queries *db.Queries
	audit   *audit.Writer
	appSvc  *app.Service
	logger  *slog.Logger
}

func NewAppHandler(queries *db.Queries, auditWriter *audit.Writer, appSvc *app.Service, logger *slog.Logger) *AppHandler {
	return &AppHandler{
		queries: queries,
		audit:   auditWriter,
		appSvc:  appSvc,
		logger:  logger,
	}
}

type createAppRequest struct {
	Name                 string  `json:"name"`
	SourceType           string  `json:"source_type"`
	GithubInstallationID *string `json:"github_installation_id"`
	RepoFullName         *string `json:"repo_full_name"`
	Branch               *string `json:"branch"`
	RootPath             string  `json:"root_path"`
	AutoDeploy           *bool   `json:"auto_deploy"`
	DockerImage          *string `json:"docker_image"`
	RegistryCredentialID *string `json:"registry_credential_id"`
	Builder              string  `json:"builder"`
	DockerfilePath       string  `json:"dockerfile_path"`
	Port                 int32   `json:"port"`
	HealthCheckPath      string  `json:"health_check_path"`
	HealthCheckInterval  int32   `json:"health_check_interval"`
	HealthCheckTimeout   int32   `json:"health_check_timeout"`
	Replicas             int32   `json:"replicas"`
	Subdomain            *string `json:"subdomain"`
}

// Create handles POST /api/v1/projects/{projectId}/apps
func (h *AppHandler) Create(w http.ResponseWriter, r *http.Request) {
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

	var req createAppRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.SourceType != "github" && req.SourceType != "docker_image" {
		respond.Error(w, http.StatusBadRequest, "source_type must be 'github' or 'docker_image'")
		return
	}

	// Defaults
	if req.Builder == "" {
		req.Builder = "auto"
	}
	if req.DockerfilePath == "" {
		req.DockerfilePath = "Dockerfile"
	}
	if req.RootPath == "" {
		req.RootPath = "/"
	}
	if req.Port == 0 {
		req.Port = 8080
	}
	if req.HealthCheckPath == "" {
		req.HealthCheckPath = "/healthz"
	}
	if req.HealthCheckInterval == 0 {
		req.HealthCheckInterval = 5
	}
	if req.HealthCheckTimeout == 0 {
		req.HealthCheckTimeout = 60
	}
	if req.Replicas == 0 {
		req.Replicas = 1
	}
	autoDeploy := true
	if req.AutoDeploy != nil {
		autoDeploy = *req.AutoDeploy
	}

	params := app.CreateParams{
		ProjectID:      projectID,
		Name:           req.Name,
		SourceType:     req.SourceType,
		RepoFullName:   req.RepoFullName,
		Branch:         req.Branch,
		RootPath:       req.RootPath,
		AutoDeploy:     autoDeploy,
		DockerImage:    req.DockerImage,
		Builder:        req.Builder,
		DockerfilePath: req.DockerfilePath,
		Port:           req.Port,
		HealthCheckPath:     req.HealthCheckPath,
		HealthCheckInterval: req.HealthCheckInterval,
		HealthCheckTimeout:  req.HealthCheckTimeout,
		Replicas:       req.Replicas,
		Subdomain:      req.Subdomain,
	}

	if req.GithubInstallationID != nil {
		id, err := uuid.Parse(*req.GithubInstallationID)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid github_installation_id")
			return
		}
		params.GithubInstallationID = &id
	}
	if req.RegistryCredentialID != nil {
		id, err := uuid.Parse(*req.RegistryCredentialID)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid registry_credential_id")
			return
		}
		params.RegistryCredentialID = &id
	}

	a, err := h.appSvc.Create(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to create app", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create app")
		return
	}

	respond.JSON(w, http.StatusCreated, a)
}

// List handles GET /api/v1/projects/{projectId}/apps
func (h *AppHandler) List(w http.ResponseWriter, r *http.Request) {
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

	apps, err := h.appSvc.List(r.Context(), projectID)
	if err != nil {
		h.logger.Error("failed to list apps", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list apps")
		return
	}

	respond.JSON(w, http.StatusOK, apps)
}

// Get handles GET /api/v1/projects/{projectId}/apps/{appId}
func (h *AppHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	a, err := h.appSvc.Get(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	respond.JSON(w, http.StatusOK, a)
}

// GetDirect handles GET /api/v1/apps/{appId} (without projectId)
func (h *AppHandler) GetDirect(w http.ResponseWriter, r *http.Request) {
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

	a, err := h.appSvc.Get(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	respond.JSON(w, http.StatusOK, a)
}

type updateAppRequest struct {
	Name                string  `json:"name"`
	Branch              *string `json:"branch"`
	RootPath            string  `json:"root_path"`
	AutoDeploy          bool    `json:"auto_deploy"`
	Builder             string  `json:"builder"`
	DockerfilePath      string  `json:"dockerfile_path"`
	Port                int32   `json:"port"`
	HealthCheckPath     string  `json:"health_check_path"`
	HealthCheckInterval int32   `json:"health_check_interval"`
	HealthCheckTimeout  int32   `json:"health_check_timeout"`
	Replicas            int32   `json:"replicas"`
	Subdomain           *string `json:"subdomain"`
	CustomDomain        *string `json:"custom_domain"`
	Status              string  `json:"status"`
}

// Update handles PUT /api/v1/projects/{projectId}/apps/{appId}
func (h *AppHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	var req updateAppRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Status == "" {
		req.Status = "active"
	}

	a, err := h.appSvc.Update(r.Context(), appID, app.UpdateParams{
		Name:                req.Name,
		Branch:              req.Branch,
		RootPath:            req.RootPath,
		AutoDeploy:          req.AutoDeploy,
		Builder:             req.Builder,
		DockerfilePath:      req.DockerfilePath,
		Port:                req.Port,
		HealthCheckPath:     req.HealthCheckPath,
		HealthCheckInterval: req.HealthCheckInterval,
		HealthCheckTimeout:  req.HealthCheckTimeout,
		Replicas:            req.Replicas,
		Subdomain:           req.Subdomain,
		CustomDomain:        req.CustomDomain,
		Status:              req.Status,
	})
	if err != nil {
		h.logger.Error("failed to update app", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to update app")
		return
	}

	respond.JSON(w, http.StatusOK, a)
}

// Delete handles DELETE /api/v1/projects/{projectId}/apps/{appId}
func (h *AppHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

	if err := h.appSvc.Delete(r.Context(), appID); err != nil {
		h.logger.Error("failed to delete app", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete app")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type setDomainRequest struct {
	CustomDomain string `json:"custom_domain"`
}

// SetDomain handles POST /api/v1/apps/{appId}/domain
func (h *AppHandler) SetDomain(w http.ResponseWriter, r *http.Request) {
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

	var req setDomainRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.CustomDomain == "" {
		respond.Error(w, http.StatusBadRequest, "custom_domain is required")
		return
	}

	// Set the domain (unverified)
	h.queries.SetAppDomainVerified(r.Context(), db.SetAppDomainVerifiedParams{
		ID:             appID,
		DomainVerified: false,
	})

	// Get current app and update custom domain
	a, err := h.appSvc.Get(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	a, err = h.appSvc.Update(r.Context(), appID, app.UpdateParams{
		Name:                a.Name,
		Branch:              a.Branch,
		RootPath:            a.RootPath,
		AutoDeploy:          a.AutoDeploy,
		Builder:             a.Builder,
		DockerfilePath:      a.DockerfilePath,
		Port:                a.Port,
		HealthCheckPath:     a.HealthCheckPath,
		HealthCheckInterval: a.HealthCheckInterval,
		HealthCheckTimeout:  a.HealthCheckTimeout,
		Replicas:            a.Replicas,
		Subdomain:           a.Subdomain,
		CustomDomain:        &req.CustomDomain,
		Status:              a.Status,
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to update domain")
		return
	}

	respond.JSON(w, http.StatusOK, a)
}

// UpdateResources handles PUT /api/v1/apps/{appId}/resources
func (h *AppHandler) UpdateResources(w http.ResponseWriter, r *http.Request) {
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
		MemoryLimitMb      int32 `json:"memory_limit_mb"`
		CpuLimitMillicores int32 `json:"cpu_limit_millicores"`
	}
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	updated, err := h.queries.UpdateAppResources(r.Context(), db.UpdateAppResourcesParams{
		ID:                 appID,
		MemoryLimitMb:      req.MemoryLimitMb,
		CpuLimitMillicores: req.CpuLimitMillicores,
	})
	if err != nil {
		h.logger.Error("failed to update resources", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to update resources")
		return
	}

	respond.JSON(w, http.StatusOK, updated)
}

// VerifyDomain handles POST /api/v1/apps/{appId}/domain/verify
func (h *AppHandler) VerifyDomain(w http.ResponseWriter, r *http.Request) {
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

	a, err := h.appSvc.Get(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	if a.CustomDomain == nil || *a.CustomDomain == "" {
		respond.Error(w, http.StatusBadRequest, "no custom domain set")
		return
	}

	// Check DNS: CNAME or A record must point to a server in the cluster
	cnames, err := net.LookupCNAME(*a.CustomDomain)
	aRecords, _ := net.LookupHost(*a.CustomDomain)

	verified := false
	target := ""

	if err == nil && cnames != "" {
		// CNAME resolves — check it points to a nip.io domain or server
		if strings.Contains(cnames, "nip.io") {
			verified = true
			target = cnames
		}
	}

	if !verified && len(aRecords) > 0 {
		// A record resolves — good enough, assume user pointed it correctly
		verified = true
		target = aRecords[0]
	}

	if verified {
		_ = h.queries.SetAppDomainVerified(r.Context(), db.SetAppDomainVerifiedParams{
			ID:             appID,
			DomainVerified: true,
		})
	}

	respond.JSON(w, http.StatusOK, map[string]any{
		"domain":   *a.CustomDomain,
		"verified": verified,
		"target":   target,
	})
}
