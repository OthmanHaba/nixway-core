package api

import (
	"log/slog"
	"net/http"

	"github.com/othmanhaba/nixway-core/internal/api/handler"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
)

func NewRouter(
	queries *db.Queries,
	sessions *auth.SessionManager,
	emailSender email.Sender,
	auditWriter *audit.Writer,
	cfg *config.Config,
	logger *slog.Logger,
) http.Handler {
	authH := handler.NewAuthHandler(queries, sessions, emailSender, auditWriter, cfg, logger)
	teamH := handler.NewTeamHandler(queries, emailSender, auditWriter, cfg, logger)
	tokenH := handler.NewTokenHandler(queries, auditWriter, cfg, logger)
	auditH := handler.NewAuditLogHandler(queries, logger)

	mux := http.NewServeMux()

	// Public routes
	mux.HandleFunc("POST /api/v1/auth/signup", authH.Signup)
	mux.HandleFunc("POST /api/v1/auth/login", authH.Login)
	mux.HandleFunc("POST /api/v1/auth/verify-email", authH.VerifyEmail)
	mux.HandleFunc("POST /api/v1/auth/forgot-password", authH.ForgotPassword)
	mux.HandleFunc("POST /api/v1/auth/reset-password", authH.ResetPassword)

	// Protected routes — use a separate mux wrapped with auth middleware
	protected := http.NewServeMux()

	// Auth (protected)
	protected.HandleFunc("POST /api/v1/auth/logout", authH.Logout)
	protected.HandleFunc("GET /api/v1/auth/me", authH.Me)

	// Teams
	protected.HandleFunc("POST /api/v1/teams", teamH.Create)
	protected.HandleFunc("GET /api/v1/teams", teamH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}", teamH.Get)
	protected.HandleFunc("PUT /api/v1/teams/{id}", teamH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{id}", teamH.Delete)

	// Team members
	protected.HandleFunc("GET /api/v1/teams/{id}/members", teamH.ListMembers)
	protected.HandleFunc("PUT /api/v1/teams/{id}/members/{userID}", teamH.UpdateMember)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/members/{userID}", teamH.RemoveMember)

	// Team invites
	protected.HandleFunc("POST /api/v1/teams/{id}/invites", teamH.CreateInvite)
	protected.HandleFunc("GET /api/v1/teams/{id}/invites", teamH.ListInvites)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/invites/{inviteID}", teamH.CancelInvite)

	// Accept invite (not team-scoped)
	protected.HandleFunc("POST /api/v1/invites/accept", teamH.AcceptInvite)

	// API tokens
	protected.HandleFunc("POST /api/v1/teams/{id}/tokens", tokenH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/tokens", tokenH.List)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/tokens/{tokenID}", tokenH.Revoke)

	// Audit logs
	protected.HandleFunc("GET /api/v1/teams/{id}/audit-logs", auditH.List)

	// Mount protected routes behind auth middleware
	authMW := middleware.Auth(queries, sessions)
	mux.Handle("/api/v1/auth/logout", authMW(protected))
	mux.Handle("/api/v1/auth/me", authMW(protected))
	mux.Handle("/api/v1/teams", authMW(protected))
	mux.Handle("/api/v1/teams/", authMW(protected))
	mux.Handle("/api/v1/invites/", authMW(protected))

	// Health check
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		respond.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Apply global middleware chain
	corsConfig := middleware.CORSConfig{
		AllowedOrigins: []string{cfg.Email.BaseURL, "http://localhost:5173"},
	}

	var h http.Handler = mux
	h = middleware.CORS(corsConfig)(h)
	h = middleware.Recover(logger)(h)
	h = middleware.Logging(logger)(h)
	h = middleware.RequestID(h)

	return h
}
