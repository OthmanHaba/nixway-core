package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/github"
)

// GitHubHandler handles GitHub App management routes.
type GitHubHandler struct {
	queries   *db.Queries
	audit     *audit.Writer
	githubSvc *github.Service
	masterKey [32]byte
	logger    *slog.Logger
}

func NewGitHubHandler(queries *db.Queries, auditWriter *audit.Writer, githubSvc *github.Service, masterKey [32]byte, logger *slog.Logger) *GitHubHandler {
	return &GitHubHandler{
		queries:   queries,
		audit:     auditWriter,
		githubSvc: githubSvc,
		masterKey: masterKey,
		logger:    logger,
	}
}

type createManifestResponse struct {
	Manifest    map[string]any `json:"manifest"`
	RedirectURL string         `json:"redirect_url"`
}

// CreateManifest generates a GitHub App manifest and redirect URL.
// POST /api/v1/teams/{id}/github/manifest
func (h *GitHubHandler) CreateManifest(w http.ResponseWriter, r *http.Request) {
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

	team, err := h.queries.GetTeamByID(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "team not found")
		return
	}

	manifest := h.githubSvc.GenerateManifest(team.ID.String(), team.Slug)

	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		h.logger.Error("failed to marshal manifest", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	redirectURL := github.DefaultGitHubBaseURL + "/settings/apps/new?manifest=" + url.QueryEscape(string(manifestJSON))

	respond.JSON(w, http.StatusOK, createManifestResponse{
		Manifest:    manifest,
		RedirectURL: redirectURL,
	})
}

type callbackRequest struct {
	Code string `json:"code"`
}

type githubAppResponse struct {
	ID        uuid.UUID `json:"id"`
	AppID     int64     `json:"app_id"`
	AppName   string    `json:"app_name"`
	AppSlug   string    `json:"app_slug"`
	HtmlUrl   string    `json:"html_url"`
	CreatedAt any       `json:"created_at"`
}

// HandleCallback exchanges a GitHub manifest code for app credentials and stores them.
// POST /api/v1/teams/{id}/github/callback
func (h *GitHubHandler) HandleCallback(w http.ResponseWriter, r *http.Request) {
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

	var req callbackRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Code == "" {
		respond.Error(w, http.StatusBadRequest, "code is required")
		return
	}

	creds, err := h.githubSvc.ExchangeCode(r.Context(), req.Code)
	if err != nil {
		h.logger.Error("failed to exchange github code", "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, "failed to exchange code with GitHub")
		return
	}

	encCtx := "github:" + teamID.String()

	encSecret, err := crypto.Encrypt([]byte(creds.ClientSecret), h.masterKey, encCtx)
	if err != nil {
		h.logger.Error("failed to encrypt client_secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	encPEM, err := crypto.Encrypt([]byte(creds.PEM), h.masterKey, encCtx)
	if err != nil {
		h.logger.Error("failed to encrypt private_key", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	encWebhook, err := crypto.Encrypt([]byte(creds.WebhookSecret), h.masterKey, encCtx)
	if err != nil {
		h.logger.Error("failed to encrypt webhook_secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	app, err := h.queries.CreateGitHubApp(r.Context(), db.CreateGitHubAppParams{
		TeamID:        teamID,
		AppID:         creds.ID,
		AppName:       creds.Name,
		AppSlug:       creds.Slug,
		ClientID:      creds.ClientID,
		ClientSecret:  encSecret,
		PrivateKey:    encPEM,
		WebhookSecret: encWebhook,
		HtmlUrl:       creds.HTMLURL,
	})
	if err != nil {
		h.logger.Error("failed to store github app", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to store GitHub app")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "github_app.create",
		ResourceType: "github_app",
		ResourceID:   &app.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, githubAppResponse{
		ID:        app.ID,
		AppID:     app.AppID,
		AppName:   app.AppName,
		AppSlug:   app.AppSlug,
		HtmlUrl:   app.HtmlUrl,
		CreatedAt: app.CreatedAt,
	})
}

// GetApp returns the GitHub App for a team (no secrets).
// GET /api/v1/teams/{id}/github/app
func (h *GitHubHandler) GetApp(w http.ResponseWriter, r *http.Request) {
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

	app, err := h.queries.GetGitHubAppByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "github app not found")
		return
	}

	_ = authCtx
	respond.JSON(w, http.StatusOK, githubAppResponse{
		ID:        app.ID,
		AppID:     app.AppID,
		AppName:   app.AppName,
		AppSlug:   app.AppSlug,
		HtmlUrl:   app.HtmlUrl,
		CreatedAt: app.CreatedAt,
	})
}

// DeleteApp deletes the GitHub App for a team.
// DELETE /api/v1/teams/{id}/github/app
func (h *GitHubHandler) DeleteApp(w http.ResponseWriter, r *http.Request) {
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

	app, err := h.queries.GetGitHubAppByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "github app not found")
		return
	}

	if err := h.queries.DeleteGitHubApp(r.Context(), db.DeleteGitHubAppParams{
		ID:     app.ID,
		TeamID: teamID,
	}); err != nil {
		h.logger.Error("failed to delete github app", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete GitHub app")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "github_app.delete",
		ResourceType: "github_app",
		ResourceID:   &app.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListInstallations lists GitHub App installations for a team.
// GET /api/v1/teams/{id}/github/installations
func (h *GitHubHandler) ListInstallations(w http.ResponseWriter, r *http.Request) {
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

	app, err := h.queries.GetGitHubAppByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "github app not found")
		return
	}

	// Reconcile live from GitHub so callers (e.g. the create-app picker) always
	// see current installations without a manual sync. Best-effort: on failure
	// we still return whatever is already persisted.
	if privateKey, derr := crypto.Decrypt(app.PrivateKey, h.masterKey, "github:"+teamID.String()); derr != nil {
		h.logger.Error("failed to decrypt private key for installation sync", "error", derr)
	} else if _, serr := h.reconcileInstallations(r.Context(), app, privateKey); serr != nil {
		h.logger.Warn("live installation sync failed, returning persisted installations", "error", serr, "team_id", teamID)
	}

	installations, err := h.queries.ListGitHubInstallations(r.Context(), app.ID)
	if err != nil {
		h.logger.Error("failed to list github installations", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_ = authCtx
	respond.JSON(w, http.StatusOK, installations)
}

// reconcileInstallations pulls the GitHub App's installations from the GitHub
// API and makes the github_installations table match: it creates ones that are
// missing, refreshes ones whose account login changed, and deletes ones that no
// longer exist (app uninstalled). Returns the number of newly created rows.
// Uses only existing queries so it never requires sqlc regeneration.
func (h *GitHubHandler) reconcileInstallations(ctx context.Context, app db.GithubApp, privateKey []byte) (int, error) {
	ghInstallations, err := h.githubSvc.ListInstallations(ctx, app.AppID, privateKey)
	if err != nil {
		return 0, err
	}

	live := make(map[int64]struct{}, len(ghInstallations))
	created := 0
	for _, inst := range ghInstallations {
		live[inst.ID] = struct{}{}

		targetType := inst.RepositorySelection
		if targetType != "all" && targetType != "selected" {
			targetType = "selected"
		}

		existing, gerr := h.queries.GetGitHubInstallation(ctx, db.GetGitHubInstallationParams{
			GithubAppID:    app.ID,
			InstallationID: inst.ID,
		})
		if gerr == nil {
			// Already known. Refresh if the account login drifted (e.g. org rename).
			if existing.AccountLogin != inst.Account.Login || existing.TargetType != targetType {
				_ = h.queries.DeleteGitHubInstallation(ctx, db.DeleteGitHubInstallationParams{
					GithubAppID:    app.ID,
					InstallationID: inst.ID,
				})
			} else {
				continue
			}
		}

		if _, cerr := h.queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
			GithubAppID:    app.ID,
			InstallationID: inst.ID,
			AccountLogin:   inst.Account.Login,
			AccountType:    inst.Account.Type,
			TargetType:     targetType,
		}); cerr != nil {
			h.logger.Error("failed to create installation", "error", cerr, "installation_id", inst.ID)
			continue
		}
		created++
	}

	// Drop installations that GitHub no longer reports (app was uninstalled).
	if persisted, lerr := h.queries.ListGitHubInstallations(ctx, app.ID); lerr == nil {
		for _, p := range persisted {
			if _, ok := live[p.InstallationID]; !ok {
				_ = h.queries.DeleteGitHubInstallation(ctx, db.DeleteGitHubInstallationParams{
					GithubAppID:    app.ID,
					InstallationID: p.InstallationID,
				})
			}
		}
	}

	return created, nil
}

// SyncInstallations polls GitHub API for installations and upserts them into the database.
// POST /api/v1/teams/{id}/github/installations/sync
func (h *GitHubHandler) SyncInstallations(w http.ResponseWriter, r *http.Request) {
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

	app, err := h.queries.GetGitHubAppByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "github app not found")
		return
	}

	privateKey, err := crypto.Decrypt(app.PrivateKey, h.masterKey, "github:"+teamID.String())
	if err != nil {
		h.logger.Error("failed to decrypt private key", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	h.logger.Info("syncing installations from GitHub", "app_id", app.AppID, "team_id", teamID)
	synced, err := h.reconcileInstallations(r.Context(), app, privateKey)
	if err != nil {
		h.logger.Error("failed to list installations from GitHub", "error", err, "app_id", app.AppID)
		respond.Error(w, http.StatusInternalServerError, "failed to fetch installations from GitHub: "+err.Error())
		return
	}

	// Re-fetch from DB to return
	installations, _ := h.queries.ListGitHubInstallations(r.Context(), app.ID)

	respond.JSON(w, http.StatusOK, map[string]any{
		"synced":        synced,
		"installations": installations,
	})
}

// ListRepos lists repositories accessible to a GitHub App installation.
// GET /api/v1/teams/{id}/github/installations/{installationId}/repos
func (h *GitHubHandler) ListRepos(w http.ResponseWriter, r *http.Request) {
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

	var installationID int64
	if _, err := fmt.Sscanf(r.PathValue("installationId"), "%d", &installationID); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid installation ID")
		return
	}

	app, err := h.queries.GetGitHubAppByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "github app not found")
		return
	}

	privateKey, err := crypto.Decrypt(app.PrivateKey, h.masterKey, "github:"+teamID.String())
	if err != nil {
		h.logger.Error("failed to decrypt private key", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	token, _, err := h.githubSvc.GetInstallationToken(r.Context(), app.AppID, installationID, privateKey)
	if err != nil {
		h.logger.Error("failed to get installation token", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to get installation token")
		return
	}

	repos, err := h.githubSvc.ListRepositories(r.Context(), token)
	if err != nil {
		h.logger.Error("failed to list repositories", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list repositories")
		return
	}

	_ = authCtx
	respond.JSON(w, http.StatusOK, repos)
}
