package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/build"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// WebhookHandler handles inbound GitHub webhook events (public route, no auth).
type WebhookHandler struct {
	queries   *db.Queries
	buildSvc  *build.Service
	masterKey [32]byte
	logger    *slog.Logger
}

func NewWebhookHandler(queries *db.Queries, buildSvc *build.Service, masterKey [32]byte, logger *slog.Logger) *WebhookHandler {
	return &WebhookHandler{
		queries:   queries,
		buildSvc:  buildSvc,
		masterKey: masterKey,
		logger:    logger,
	}
}

// HandleGitHub handles POST /api/v1/webhooks/github/{appId}
func (h *WebhookHandler) HandleGitHub(w http.ResponseWriter, r *http.Request) {
	appIDStr := r.PathValue("appId")
	appID, err := strconv.ParseInt(appIDStr, 10, 64)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid app ID")
		return
	}

	app, err := h.queries.GetGitHubAppByAppID(r.Context(), appID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	h.handleGitHubWithApp(w, r, app)
}

// HandleGitHubTeam handles POST /api/v1/webhooks/github/team/{teamId}.
// GitHub App manifests are created before GitHub assigns an app ID, so the
// manifest webhook URL is team-scoped and resolves the current app by team.
func (h *WebhookHandler) HandleGitHubTeam(w http.ResponseWriter, r *http.Request) {
	teamID, err := uuid.Parse(r.PathValue("teamId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	app, err := h.queries.GetGitHubAppByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "app not found")
		return
	}

	h.handleGitHubWithApp(w, r, app)
}

func (h *WebhookHandler) handleGitHubWithApp(w http.ResponseWriter, r *http.Request, app db.GithubApp) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to read request body")
		return
	}

	sigHeader := r.Header.Get("X-Hub-Signature-256")
	if sigHeader == "" {
		respond.Error(w, http.StatusUnauthorized, "missing signature")
		return
	}

	webhookSecret, err := crypto.Decrypt(app.WebhookSecret, h.masterKey, "github:"+app.TeamID.String())
	if err != nil {
		h.logger.Error("failed to decrypt webhook secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	mac := hmac.New(sha256.New, webhookSecret)
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(sigHeader), []byte(expected)) {
		respond.Error(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	deliveryID := r.Header.Get("X-GitHub-Delivery")
	eventType := r.Header.Get("X-GitHub-Event")

	// Parse action from payload
	var payload struct {
		Action       *string `json:"action"`
		Installation *struct {
			ID      int64 `json:"id"`
			Account struct {
				Login string `json:"login"`
				Type  string `json:"type"`
			} `json:"account"`
			TargetType string `json:"target_type"`
		} `json:"installation"`
	}
	_ = json.Unmarshal(body, &payload)

	// Idempotency check
	if deliveryID != "" {
		_, err := h.queries.GetWebhookEventByDeliveryID(r.Context(), deliveryID)
		if err == nil {
			// Already processed
			respond.JSON(w, http.StatusOK, map[string]string{"status": "already_processed"})
			return
		}
	}

	// Store the event
	_, err = h.queries.CreateWebhookEvent(r.Context(), db.CreateWebhookEventParams{
		GithubAppID: app.ID,
		EventType:   eventType,
		Action:      payload.Action,
		DeliveryID:  deliveryID,
		Payload:     body,
	})
	if err != nil {
		h.logger.Error("failed to store webhook event", "error", err, "delivery_id", deliveryID)
		respond.Error(w, http.StatusInternalServerError, "failed to store event")
		return
	}

	// Handle installation lifecycle events
	if eventType == "installation" && payload.Action != nil && payload.Installation != nil {
		inst := payload.Installation
		switch *payload.Action {
		case "created":
			accountType := inst.Account.Type
			targetType := inst.TargetType
			if targetType == "" {
				targetType = "Organization"
			}
			_, createErr := h.queries.CreateGitHubInstallation(r.Context(), db.CreateGitHubInstallationParams{
				GithubAppID:    app.ID,
				InstallationID: inst.ID,
				AccountLogin:   inst.Account.Login,
				AccountType:    accountType,
				TargetType:     targetType,
			})
			if createErr != nil {
				h.logger.Error("failed to create installation record", "error", createErr, "installation_id", inst.ID)
			}

		case "deleted":
			deleteErr := h.queries.DeleteGitHubInstallation(r.Context(), db.DeleteGitHubInstallationParams{
				GithubAppID:    app.ID,
				InstallationID: inst.ID,
			})
			if deleteErr != nil {
				h.logger.Error("failed to delete installation record", "error", deleteErr, "installation_id", inst.ID)
			}

		case "suspend":
			now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
			updateErr := h.queries.UpdateGitHubInstallationSuspended(r.Context(), db.UpdateGitHubInstallationSuspendedParams{
				GithubAppID:    app.ID,
				InstallationID: inst.ID,
				SuspendedAt:    now,
			})
			if updateErr != nil {
				h.logger.Error("failed to suspend installation", "error", updateErr, "installation_id", inst.ID)
			}

		case "unsuspend":
			cleared := pgtype.Timestamptz{Valid: false}
			updateErr := h.queries.UpdateGitHubInstallationSuspended(r.Context(), db.UpdateGitHubInstallationSuspendedParams{
				GithubAppID:    app.ID,
				InstallationID: inst.ID,
				SuspendedAt:    cleared,
			})
			if updateErr != nil {
				h.logger.Error("failed to unsuspend installation", "error", updateErr, "installation_id", inst.ID)
			}
		}
	}

	// Handle push events → trigger builds for linked apps
	if eventType == "push" && h.buildSvc != nil {
		var pushPayload struct {
			Ref        string `json:"ref"`
			After      string `json:"after"` // commit SHA
			HeadCommit *struct {
				Message string `json:"message"`
			} `json:"head_commit"`
			Repository struct {
				FullName string `json:"full_name"`
			} `json:"repository"`
		}
		if err := json.Unmarshal(body, &pushPayload); err == nil {
			// Extract branch from ref (refs/heads/main → main)
			branch := ""
			if len(pushPayload.Ref) > 11 && pushPayload.Ref[:11] == "refs/heads/" {
				branch = pushPayload.Ref[11:]
			}

			if branch != "" && pushPayload.Repository.FullName != "" {
				// Find apps linked to this repo with auto_deploy enabled
				apps, err := h.queries.ListAppsByRepo(r.Context(), &pushPayload.Repository.FullName)
				if err == nil {
					for _, linkedApp := range apps {
						// Check branch matches
						if linkedApp.Branch != nil && *linkedApp.Branch != branch {
							continue
						}

						// Find production environment for this app's project
						envs, err := h.queries.ListEnvironmentsByProject(r.Context(), linkedApp.ProjectID)
						if err != nil || len(envs) == 0 {
							continue
						}

						var envID uuid.UUID
						for _, env := range envs {
							if env.IsProduction {
								envID = env.ID
								break
							}
						}
						if envID == uuid.Nil {
							envID = envs[0].ID
						}

						_, buildErr := h.buildSvc.TriggerBuild(r.Context(), linkedApp.ID, envID, "push", pushPayload.After, branch)
						if buildErr != nil {
							h.logger.Error("failed to trigger build from push", "app_id", linkedApp.ID, "error", buildErr)
						} else {
							h.logger.Info("build triggered from push", "app_id", linkedApp.ID, "repo", pushPayload.Repository.FullName, "branch", branch)
						}
					}
				}
			}
		}
	}

	respond.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
