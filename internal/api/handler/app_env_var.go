package handler

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/appenv"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/deploy"
)

// envVarKeyPattern matches valid POSIX-style environment variable names.
var envVarKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// reservedEnvKeys are injected by the platform at deploy time and would silently
// override any user-supplied value, so we reject them at write time.
var reservedEnvKeys = map[string]bool{
	"PORT":                    true,
	"PLATFORM_PUBLIC_DOMAIN":  true,
	"PLATFORM_PRIVATE_IP":     true,
	"PLATFORM_PRIVATE_DOMAIN": true,
	"CLUSTER_NAME":            true,
	"PROJECT_NAME":            true,
	"APP_NAME":                true,
	"ENVIRONMENT":             true,
	"DEPLOY_ID":               true,
	"GIT_SHA":                 true,
}

type AppEnvVarHandler struct {
	queries   *db.Queries
	appEnvSvc *appenv.Service
	deploySvc *deploy.Service
	audit     *audit.Writer
	logger    *slog.Logger
}

func NewAppEnvVarHandler(queries *db.Queries, appEnvSvc *appenv.Service, deploySvc *deploy.Service, auditWriter *audit.Writer, logger *slog.Logger) *AppEnvVarHandler {
	return &AppEnvVarHandler{
		queries:   queries,
		appEnvSvc: appEnvSvc,
		deploySvc: deploySvc,
		audit:     auditWriter,
		logger:    logger,
	}
}

type appEnvVarResponse struct {
	ID            uuid.UUID `json:"id"`
	AppID         uuid.UUID `json:"app_id"`
	EnvironmentID uuid.UUID `json:"environment_id"`
	Key           string    `json:"key"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func toAppEnvVarResponse(v db.AppEnvVar) appEnvVarResponse {
	return appEnvVarResponse{
		ID:            v.ID,
		AppID:         v.AppID,
		EnvironmentID: v.EnvironmentID,
		Key:           v.Key,
		CreatedAt:     v.CreatedAt,
		UpdatedAt:     v.UpdatedAt,
	}
}

// resolveEnv loads the app and resolves the environment by slug. The slug comes
// from the `environment` query param (defaulting to "production").
func (h *AppEnvVarHandler) resolveEnv(ctx context.Context, appID uuid.UUID, slug string) (db.App, db.Environment, error) {
	app, err := h.queries.GetApp(ctx, appID)
	if err != nil {
		return db.App{}, db.Environment{}, err
	}
	if slug == "" {
		slug = "production"
	}
	env, err := h.queries.GetEnvironmentBySlug(ctx, db.GetEnvironmentBySlugParams{
		ProjectID: app.ProjectID,
		Slug:      slug,
	})
	if err != nil {
		return app, db.Environment{}, err
	}
	return app, env, nil
}

// List handles GET /api/v1/apps/{appId}/env-vars?environment={slug}
func (h *AppEnvVarHandler) List(w http.ResponseWriter, r *http.Request) {
	if middleware.GetAuthContext(r) == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}

	_, env, err := h.resolveEnv(r.Context(), appID, r.URL.Query().Get("environment"))
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app or environment not found")
		return
	}

	rows, err := h.appEnvSvc.List(r.Context(), appID, env.ID)
	if err != nil {
		h.logger.Error("failed to list app env vars", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	resp := make([]appEnvVarResponse, 0, len(rows))
	for _, row := range rows {
		resp = append(resp, appEnvVarResponse{
			ID:            row.ID,
			AppID:         row.AppID,
			EnvironmentID: row.EnvironmentID,
			Key:           row.Key,
			CreatedAt:     row.CreatedAt,
			UpdatedAt:     row.UpdatedAt,
		})
	}
	respond.JSON(w, http.StatusOK, resp)
}

type setAppEnvVarRequest struct {
	Environment string `json:"environment"`
	Key         string `json:"key"`
	Value       string `json:"value"`
}

// Create handles POST /api/v1/apps/{appId}/env-vars
func (h *AppEnvVarHandler) Create(w http.ResponseWriter, r *http.Request) {
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

	var req setAppEnvVarRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if msg := validateEnvKey(req.Key); msg != "" {
		respond.Error(w, http.StatusBadRequest, msg)
		return
	}

	app, env, err := h.resolveEnv(r.Context(), appID, req.Environment)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app or environment not found")
		return
	}

	row, err := h.appEnvSvc.Set(r.Context(), appID, env.ID, req.Key, req.Value, authCtx.UserID)
	if err != nil {
		h.logger.Error("failed to set app env var", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	h.auditEnvVar(r, app.ProjectID, "app_env_var.create", row.ID)
	h.triggerRedeploy(appID, env.ID)

	respond.JSON(w, http.StatusCreated, toAppEnvVarResponse(row))
}

// Reveal handles POST /api/v1/apps/{appId}/env-vars/{varId}/reveal
func (h *AppEnvVarHandler) Reveal(w http.ResponseWriter, r *http.Request) {
	if middleware.GetAuthContext(r) == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}
	varID, err := uuid.Parse(r.PathValue("varId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid env var ID")
		return
	}

	value, err := h.appEnvSvc.Reveal(r.Context(), varID, appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "env var not found")
		return
	}
	respond.JSON(w, http.StatusOK, map[string]string{"value": value})
}

type updateAppEnvVarRequest struct {
	Value string `json:"value"`
}

// Update handles PUT /api/v1/apps/{appId}/env-vars/{varId}
func (h *AppEnvVarHandler) Update(w http.ResponseWriter, r *http.Request) {
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
	varID, err := uuid.Parse(r.PathValue("varId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid env var ID")
		return
	}

	var req updateAppEnvVarRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	existing, err := h.queries.GetAppEnvVarByID(r.Context(), db.GetAppEnvVarByIDParams{
		ID:    varID,
		AppID: appID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "env var not found")
		return
	}

	row, err := h.appEnvSvc.Set(r.Context(), appID, existing.EnvironmentID, existing.Key, req.Value, authCtx.UserID)
	if err != nil {
		h.logger.Error("failed to update app env var", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if app, err := h.queries.GetApp(r.Context(), appID); err == nil {
		h.auditEnvVar(r, app.ProjectID, "app_env_var.update", row.ID)
	}
	h.triggerRedeploy(appID, existing.EnvironmentID)

	respond.JSON(w, http.StatusOK, toAppEnvVarResponse(row))
}

// Delete handles DELETE /api/v1/apps/{appId}/env-vars/{varId}
func (h *AppEnvVarHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if middleware.GetAuthContext(r) == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}
	varID, err := uuid.Parse(r.PathValue("varId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid env var ID")
		return
	}

	existing, err := h.queries.GetAppEnvVarByID(r.Context(), db.GetAppEnvVarByIDParams{
		ID:    varID,
		AppID: appID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "env var not found")
		return
	}

	if err := h.appEnvSvc.Delete(r.Context(), varID, appID); err != nil {
		h.logger.Error("failed to delete app env var", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if app, err := h.queries.GetApp(r.Context(), appID); err == nil {
		h.auditEnvVar(r, app.ProjectID, "app_env_var.delete", varID)
	}
	h.triggerRedeploy(appID, existing.EnvironmentID)

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// validateEnvKey returns an error message if the key is empty, malformed, or
// reserved by the platform. Empty string means valid.
func validateEnvKey(key string) string {
	if key == "" {
		return "key is required"
	}
	if !envVarKeyPattern.MatchString(key) {
		return "key must match ^[A-Za-z_][A-Za-z0-9_]*$"
	}
	if reservedEnvKeys[key] {
		return "key is reserved by the platform and cannot be set"
	}
	return ""
}

// auditEnvVar records an audit entry; teamID is resolved from the project.
func (h *AppEnvVarHandler) auditEnvVar(r *http.Request, projectID uuid.UUID, action string, resourceID uuid.UUID) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		return
	}
	project, err := h.queries.GetProject(r.Context(), projectID)
	if err != nil {
		return
	}
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &project.TeamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       action,
		ResourceType: "app_env_var",
		ResourceID:   &resourceID,
		IPAddress:    parseIP(r),
	})
}

// triggerRedeploy re-rolls the app into the given environment so an env-var
// change takes effect. Best-effort and non-blocking: an app with no healthy
// deployment yet simply picks up the change on its next manual deploy.
func (h *AppEnvVarHandler) triggerRedeploy(appID, envID uuid.UUID) {
	if h.deploySvc == nil {
		return
	}
	go func() {
		if _, err := h.deploySvc.RedeployAppEnv(context.Background(), appID, envID); err != nil {
			h.logger.Debug("env-var redeploy skipped", "app_id", appID, "env_id", envID, "error", err)
		}
	}()
}
