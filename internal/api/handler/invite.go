package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
)

type createInviteRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (h *TeamHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeInvitesWrite); !ok {
		return
	}

	var req createInviteRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Email == "" {
		respond.Error(w, http.StatusBadRequest, "email is required")
		return
	}
	if req.Role == "" {
		req.Role = string(model.RoleMember)
	}

	token := uuid.New().String()
	authCtx := middleware.GetAuthContext(r)

	invite, err := h.queries.CreateInvite(r.Context(), db.CreateInviteParams{
		TeamID:    teamID,
		Email:     req.Email,
		Role:      req.Role,
		Token:     auth.HashToken(token),
		InvitedBy: authCtx.UserID,
		ExpiresAt: time.Now().Add(h.config.Auth.InviteTTL),
	})
	if err != nil {
		h.logger.Error("failed to create invite", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Send invite email
	inviteURL := fmt.Sprintf("%s/invites/accept/%s", h.config.Email.BaseURL, auth.HashToken(token))
	subject := "You've been invited to a Nixway team"
	body := fmt.Sprintf("You've been invited to join a team. Click here to accept: %s", inviteURL)
	_ = h.email.Send(r.Context(), req.Email, subject, body, body)

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "invite.create",
		ResourceType: "invite",
		ResourceID:   &invite.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, model.TeamInvite{
		ID:        invite.ID,
		TeamID:    invite.TeamID,
		Email:     invite.Email,
		Role:      invite.Role,
		ExpiresAt: invite.ExpiresAt,
		CreatedAt: invite.CreatedAt,
	})
}

func (h *TeamHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember, model.ScopeInvitesRead); !ok {
		return
	}

	invites, err := h.queries.ListInvitesByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list invites", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	result := make([]model.TeamInvite, len(invites))
	for i, inv := range invites {
		result[i] = model.TeamInvite{
			ID:          inv.ID,
			TeamID:      inv.TeamID,
			Email:       inv.Email,
			Role:        inv.Role,
			InviterName: inv.InviterName,
			ExpiresAt:   inv.ExpiresAt,
			CreatedAt:   inv.CreatedAt,
		}
	}

	respond.JSON(w, http.StatusOK, result)
}

func (h *TeamHandler) CancelInvite(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleAdmin, model.ScopeInvitesWrite); !ok {
		return
	}

	inviteIDStr := r.PathValue("inviteID")
	inviteID, err := uuid.Parse(inviteIDStr)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid invite id")
		return
	}

	if err := h.queries.DeleteInvite(r.Context(), inviteID); err != nil {
		h.logger.Error("failed to cancel invite", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	authCtx := middleware.GetAuthContext(r)
	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "invite.cancel",
		ResourceType: "invite",
		ResourceID:   &inviteID,
		IPAddress:    ip,
	})

	w.WriteHeader(http.StatusNoContent)
}

type acceptInviteRequest struct {
	Token string `json:"token"`
}

func (h *TeamHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req acceptInviteRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	invite, err := h.queries.GetInviteByToken(r.Context(), req.Token)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid or expired invite token")
		return
	}

	// Verify the accepting user's email matches the invite
	user, err := h.queries.GetUserByID(r.Context(), authCtx.UserID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if user.Email != invite.Email {
		respond.Error(w, http.StatusForbidden, "invite is for a different email address")
		return
	}

	// Create membership
	_, err = h.queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		TeamID: invite.TeamID,
		UserID: authCtx.UserID,
		Role:   invite.Role,
	})
	if err != nil {
		respond.Error(w, http.StatusConflict, "already a member of this team")
		return
	}

	// Delete the invite
	_ = h.queries.DeleteInvite(r.Context(), invite.ID)

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &invite.TeamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "invite.accept",
		ResourceType: "invite",
		ResourceID:   &invite.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "invite accepted"})
}
