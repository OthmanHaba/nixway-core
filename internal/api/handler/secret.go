package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/secret"
)

type SecretHandler struct {
	queries   *db.Queries
	audit     *audit.Writer
	secretSvc *secret.Service
	logger    *slog.Logger
}

func NewSecretHandler(queries *db.Queries, auditWriter *audit.Writer, secretSvc *secret.Service, logger *slog.Logger) *SecretHandler {
	return &SecretHandler{
		queries:   queries,
		audit:     auditWriter,
		secretSvc: secretSvc,
		logger:    logger,
	}
}

type secretResponse struct {
	ID          uuid.UUID  `json:"id"`
	TeamID      uuid.UUID  `json:"team_id"`
	Environment string     `json:"environment"`
	Key         string     `json:"key"`
	Version     int32      `json:"version"`
	RevealedAt  *time.Time `json:"revealed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func toSecretResponse(s db.Secret) secretResponse {
	r := secretResponse{
		ID:          s.ID,
		TeamID:      s.TeamID,
		Environment: s.Environment,
		Key:         s.Key,
		Version:     s.Version,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
	}
	if s.RevealedAt.Valid {
		t := s.RevealedAt.Time
		r.RevealedAt = &t
	}
	return r
}

func secretResponseFromListRow(s db.ListSecretsRow) secretResponse {
	r := secretResponse{
		ID:          s.ID,
		TeamID:      s.TeamID,
		Environment: s.Environment,
		Key:         s.Key,
		Version:     s.Version,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
	}
	if s.RevealedAt.Valid {
		t := s.RevealedAt.Time
		r.RevealedAt = &t
	}
	return r
}

func secretResponseFromTeamRow(s db.ListSecretsByTeamRow) secretResponse {
	r := secretResponse{
		ID:          s.ID,
		TeamID:      s.TeamID,
		Environment: s.Environment,
		Key:         s.Key,
		Version:     s.Version,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
	}
	if s.RevealedAt.Valid {
		t := s.RevealedAt.Time
		r.RevealedAt = &t
	}
	return r
}

// pgRevealedAt converts a pgtype.Timestamptz to *time.Time for the response.
// Kept here to satisfy the unused import check if needed; actual use is inline above.
var _ = pgtype.Timestamptz{}

type createSecretRequest struct {
	Environment string `json:"environment"`
	Key         string `json:"key"`
	Value       string `json:"value"`
}

func (h *SecretHandler) Create(w http.ResponseWriter, r *http.Request) {
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

	var req createSecretRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Key == "" || req.Value == "" {
		respond.Error(w, http.StatusBadRequest, "key and value are required")
		return
	}
	if req.Environment == "" {
		req.Environment = "production"
	}

	s, err := h.secretSvc.Create(r.Context(), teamID, req.Environment, req.Key, req.Value, authCtx.UserID)
	if err != nil {
		h.logger.Error("failed to create secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "secret.create",
		ResourceType: "secret",
		ResourceID:   &s.ID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusCreated, toSecretResponse(s))
}

func (h *SecretHandler) List(w http.ResponseWriter, r *http.Request) {
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

	environment := r.URL.Query().Get("environment")
	if environment != "" {
		rows, err := h.secretSvc.List(r.Context(), teamID, environment)
		if err != nil {
			h.logger.Error("failed to list secrets", "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}
		resp := make([]secretResponse, 0, len(rows))
		for _, s := range rows {
			resp = append(resp, secretResponseFromListRow(s))
		}
		respond.JSON(w, http.StatusOK, resp)
		return
	}

	rows, err := h.queries.ListSecretsByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list secrets by team", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	resp := make([]secretResponse, 0, len(rows))
	for _, s := range rows {
		resp = append(resp, secretResponseFromTeamRow(s))
	}
	respond.JSON(w, http.StatusOK, resp)
}

func (h *SecretHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	secretID, err := uuid.Parse(r.PathValue("secretId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid secret ID")
		return
	}

	s, err := h.queries.GetSecretByID(r.Context(), db.GetSecretByIDParams{
		ID:     secretID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "secret not found")
		return
	}

	respond.JSON(w, http.StatusOK, toSecretResponse(s))
}

func (h *SecretHandler) Reveal(w http.ResponseWriter, r *http.Request) {
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

	secretID, err := uuid.Parse(r.PathValue("secretId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid secret ID")
		return
	}

	plaintext, err := h.secretSvc.Reveal(r.Context(), secretID, teamID, &authCtx.UserID, "user", parseIP(r))
	if err != nil {
		if errors.Is(err, secret.ErrAlreadyRevealed) {
			respond.Error(w, http.StatusConflict, "secret has already been revealed")
			return
		}
		h.logger.Error("failed to reveal secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "secret.reveal",
		ResourceType: "secret",
		ResourceID:   &secretID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusOK, map[string]string{"value": plaintext})
}

type updateSecretRequest struct {
	Value string `json:"value"`
}

func (h *SecretHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	secretID, err := uuid.Parse(r.PathValue("secretId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid secret ID")
		return
	}

	var req updateSecretRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Value == "" {
		respond.Error(w, http.StatusBadRequest, "value is required")
		return
	}

	s, err := h.secretSvc.Update(r.Context(), secretID, teamID, req.Value, authCtx.UserID)
	if err != nil {
		h.logger.Error("failed to update secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "secret.update",
		ResourceType: "secret",
		ResourceID:   &secretID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusOK, toSecretResponse(s))
}

func (h *SecretHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

	secretID, err := uuid.Parse(r.PathValue("secretId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid secret ID")
		return
	}

	if err := h.secretSvc.Delete(r.Context(), secretID, teamID, &authCtx.UserID, "user", parseIP(r)); err != nil {
		h.logger.Error("failed to delete secret", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete secret")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "secret.delete",
		ResourceType: "secret",
		ResourceID:   &secretID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
