package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"time"

	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/othmanhaba/nixway-core/internal/model"

	"github.com/jackc/pgx/v5/pgtype"
)

type AuthHandler struct {
	queries  *db.Queries
	sessions *auth.SessionManager
	email    email.Sender
	audit    *audit.Writer
	config   *config.Config
	logger   *slog.Logger
}

func NewAuthHandler(
	queries *db.Queries,
	sessions *auth.SessionManager,
	emailSender email.Sender,
	auditWriter *audit.Writer,
	cfg *config.Config,
	logger *slog.Logger,
) *AuthHandler {
	return &AuthHandler{
		queries:  queries,
		sessions: sessions,
		email:    emailSender,
		audit:    auditWriter,
		config:   cfg,
		logger:   logger,
	}
}

type signupRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (h *AuthHandler) Signup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if _, err := mail.ParseAddress(req.Email); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := auth.ValidatePasswordStrength(req.Password); err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	hash, err := auth.HashPassword(req.Password, h.config.Auth.BcryptCost)
	if err != nil {
		h.logger.Error("failed to hash password", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_, tokenHash, err := auth.GenerateAPIToken(32)
	if err != nil {
		h.logger.Error("failed to generate verify token", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	expires := time.Now().Add(h.config.Auth.VerifyEmailTTL)

	user, err := h.queries.CreateUser(r.Context(), db.CreateUserParams{
		Email:              req.Email,
		PasswordHash:       hash,
		Name:               req.Name,
		EmailVerifyToken:   &tokenHash,
		EmailVerifyExpires: pgtype.Timestamptz{Time: expires, Valid: true},
	})
	if err != nil {
		respond.Error(w, http.StatusConflict, "email already registered")
		return
	}

	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", h.config.Email.BaseURL, tokenHash)
	subject := "Verify your Nixway email"
	body := fmt.Sprintf("Click here to verify your email: %s", verifyURL)
	_ = h.email.Send(r.Context(), req.Email, subject, body, body)

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		ActorID:      &user.ID,
		ActorType:    "user",
		Action:       "user.signup",
		ResourceType: "user",
		ResourceID:   &user.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, model.User{
		ID:            user.ID,
		Email:         user.Email,
		Name:          user.Name,
		EmailVerified: user.EmailVerified,
		CreatedAt:     user.CreatedAt,
		UpdatedAt:     user.UpdatedAt,
	})
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := h.queries.GetUserByVerifyToken(r.Context(), &req.Token)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid or expired verification token")
		return
	}

	if err := h.queries.VerifyUserEmail(r.Context(), user.ID); err != nil {
		h.logger.Error("failed to verify email", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		ActorID:      &user.ID,
		ActorType:    "user",
		Action:       "user.verify_email",
		ResourceType: "user",
		ResourceID:   &user.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "email verified"})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := h.queries.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		respond.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !auth.CheckPassword(req.Password, user.PasswordHash) {
		respond.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !user.EmailVerified {
		respond.Error(w, http.StatusForbidden, "email not verified")
		return
	}

	sessionID, err := h.sessions.Create(r.Context(), user.ID, user.Email, user.Name)
	if err != nil {
		h.logger.Error("failed to create session", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.config.Auth.SessionTTL.Seconds()),
	})

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		ActorID:      &user.ID,
		ActorType:    "user",
		Action:       "user.login",
		ResourceType: "user",
		ResourceID:   &user.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, model.User{
		ID:            user.ID,
		Email:         user.Email,
		Name:          user.Name,
		EmailVerified: user.EmailVerified,
		CreatedAt:     user.CreatedAt,
		UpdatedAt:     user.UpdatedAt,
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session")
	if err == nil {
		_ = h.sessions.Delete(r.Context(), cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		MaxAge:   -1,
	})

	authCtx := middleware.GetAuthContext(r)
	if authCtx != nil {
		ip := parseIP(r)
		_ = h.audit.Log(r.Context(), audit.Entry{
			ActorID:      &authCtx.UserID,
			ActorType:    "user",
			Action:       "user.logout",
			ResourceType: "user",
			ResourceID:   &authCtx.UserID,
			IPAddress:    ip,
		})
	}

	respond.JSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Always return success to prevent email enumeration
	defer respond.JSON(w, http.StatusOK, map[string]string{"status": "if the email exists, a reset link has been sent"})

	user, err := h.queries.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		return
	}

	_, tokenHash, err := auth.GenerateAPIToken(32)
	if err != nil {
		h.logger.Error("failed to generate reset token", "error", err)
		return
	}

	expires := time.Now().Add(h.config.Auth.PasswordResetTTL)
	err = h.queries.SetPasswordResetToken(r.Context(), db.SetPasswordResetTokenParams{
		ID:                   user.ID,
		PasswordResetToken:   &tokenHash,
		PasswordResetExpires: pgtype.Timestamptz{Time: expires, Valid: true},
	})
	if err != nil {
		h.logger.Error("failed to set reset token", "error", err)
		return
	}

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", h.config.Email.BaseURL, tokenHash)
	subject := "Reset your Nixway password"
	body := fmt.Sprintf("Click here to reset your password: %s", resetURL)
	_ = h.email.Send(r.Context(), req.Email, subject, body, body)
}

type resetPasswordRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := auth.ValidatePasswordStrength(req.Password); err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := h.queries.GetUserByResetToken(r.Context(), &req.Token)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid or expired reset token")
		return
	}

	hash, err := auth.HashPassword(req.Password, h.config.Auth.BcryptCost)
	if err != nil {
		h.logger.Error("failed to hash password", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if err := h.queries.UpdatePassword(r.Context(), db.UpdatePasswordParams{
		ID:           user.ID,
		PasswordHash: hash,
	}); err != nil {
		h.logger.Error("failed to update password", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		ActorID:      &user.ID,
		ActorType:    "user",
		Action:       "user.reset_password",
		ResourceType: "user",
		ResourceID:   &user.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "password reset successfully"})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	user, err := h.queries.GetUserByID(r.Context(), authCtx.UserID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "user not found")
		return
	}

	respond.JSON(w, http.StatusOK, model.User{
		ID:            user.ID,
		Email:         user.Email,
		Name:          user.Name,
		EmailVerified: user.EmailVerified,
		CreatedAt:     user.CreatedAt,
		UpdatedAt:     user.UpdatedAt,
	})
}
