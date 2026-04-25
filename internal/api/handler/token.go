package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
)

type TokenHandler struct {
	queries *db.Queries
	audit   *audit.Writer
	config  *config.Config
	logger  *slog.Logger
}

func NewTokenHandler(
	queries *db.Queries,
	auditWriter *audit.Writer,
	cfg *config.Config,
	logger *slog.Logger,
) *TokenHandler {
	return &TokenHandler{
		queries: queries,
		audit:   auditWriter,
		config:  cfg,
		logger:  logger,
	}
}

type createTokenRequest struct {
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	ExpiresIn *string  `json:"expires_in,omitempty"` // e.g. "720h"
}

func (h *TokenHandler) Create(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeTokensWrite); !ok {
		return
	}

	var req createTokenRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}
	for _, scope := range req.Scopes {
		if !model.ValidTokenScope(scope) {
			respond.Error(w, http.StatusBadRequest, "unknown token scope: "+scope)
			return
		}
	}

	plain, hash, err := auth.GenerateAPIToken(h.config.Auth.TokenLength)
	if err != nil {
		h.logger.Error("failed to generate token", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	var expiresAt pgtype.Timestamptz
	if req.ExpiresIn != nil {
		dur, err := time.ParseDuration(*req.ExpiresIn)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid expires_in duration")
			return
		}
		expiresAt = pgtype.Timestamptz{Time: time.Now().Add(dur), Valid: true}
	}

	authCtx := middleware.GetAuthContext(r)
	token, err := h.queries.CreateAPIToken(r.Context(), db.CreateAPITokenParams{
		TeamID:    teamID,
		UserID:    authCtx.UserID,
		Name:      req.Name,
		TokenHash: hash,
		Scopes:    req.Scopes,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		h.logger.Error("failed to create token", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "token.create",
		ResourceType: "api_token",
		ResourceID:   &token.ID,
		IPAddress:    ip,
	})

	var expiresAtPtr *time.Time
	if token.ExpiresAt.Valid {
		expiresAtPtr = &token.ExpiresAt.Time
	}

	respond.JSON(w, http.StatusCreated, model.APITokenWithPlain{
		APIToken: model.APIToken{
			ID:        token.ID,
			TeamID:    token.TeamID,
			UserID:    token.UserID,
			Name:      token.Name,
			Scopes:    token.Scopes,
			ExpiresAt: expiresAtPtr,
			CreatedAt: token.CreatedAt,
		},
		PlainToken: plain,
	})
}

func (h *TokenHandler) List(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember, model.ScopeTokensRead); !ok {
		return
	}

	tokens, err := h.queries.ListAPITokensByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list tokens", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	result := make([]model.APIToken, len(tokens))
	for i, t := range tokens {
		var lastUsed, expires *time.Time
		if t.LastUsedAt.Valid {
			lastUsed = &t.LastUsedAt.Time
		}
		if t.ExpiresAt.Valid {
			expires = &t.ExpiresAt.Time
		}
		result[i] = model.APIToken{
			ID:         t.ID,
			TeamID:     t.TeamID,
			UserID:     t.UserID,
			Name:       t.Name,
			Scopes:     t.Scopes,
			LastUsedAt: lastUsed,
			ExpiresAt:  expires,
			CreatedAt:  t.CreatedAt,
		}
	}

	respond.JSON(w, http.StatusOK, result)
}

func (h *TokenHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeTokensWrite); !ok {
		return
	}

	tokenIDStr := r.PathValue("tokenID")
	tokenID, err := uuid.Parse(tokenIDStr)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid token id")
		return
	}

	if err := h.queries.RevokeAPIToken(r.Context(), db.RevokeAPITokenParams{
		ID:     tokenID,
		TeamID: teamID,
	}); err != nil {
		h.logger.Error("failed to revoke token", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	authCtx := middleware.GetAuthContext(r)
	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "token.revoke",
		ResourceType: "api_token",
		ResourceID:   &tokenID,
		IPAddress:    ip,
	})

	w.WriteHeader(http.StatusNoContent)
}
