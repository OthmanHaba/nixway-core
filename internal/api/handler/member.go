package handler

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
)

func (h *TeamHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleMember); !ok {
		return
	}

	members, err := h.queries.ListMembersByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list members", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	result := make([]model.TeamMember, len(members))
	for i, m := range members {
		result[i] = model.TeamMember{
			ID:        m.ID,
			TeamID:    m.TeamID,
			UserID:    m.UserID,
			Role:      m.Role,
			Email:     m.Email,
			UserName:  m.UserName,
			CreatedAt: m.CreatedAt,
		}
	}

	respond.JSON(w, http.StatusOK, result)
}

type updateMemberRequest struct {
	Role string `json:"role"`
}

func (h *TeamHandler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleOwner); !ok {
		return
	}

	userIDStr := r.PathValue("userID")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var req updateMemberRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Role == "" {
		respond.Error(w, http.StatusBadRequest, "role is required")
		return
	}

	// Last-owner protection: if demoting an owner, ensure there's at least one other owner
	membership, err := h.queries.GetMembership(r.Context(), db.GetMembershipParams{
		TeamID: teamID,
		UserID: userID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "member not found")
		return
	}

	if membership.Role == string(model.RoleOwner) && req.Role != string(model.RoleOwner) {
		count, err := h.queries.CountOwners(r.Context(), teamID)
		if err != nil {
			h.logger.Error("failed to count owners", "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if count <= 1 {
			respond.Error(w, http.StatusBadRequest, "cannot demote the last owner")
			return
		}
	}

	if err := h.queries.UpdateMemberRole(r.Context(), db.UpdateMemberRoleParams{
		TeamID: teamID,
		UserID: userID,
		Role:   req.Role,
	}); err != nil {
		h.logger.Error("failed to update member role", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	authCtx := middleware.GetAuthContext(r)
	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "member.update_role",
		ResourceType: "member",
		ResourceID:   &userID,
		IPAddress:    ip,
		Metadata:     map[string]string{"new_role": req.Role},
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "role updated"})
}

func (h *TeamHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	teamID, ok := parseTeamID(w, r)
	if !ok {
		return
	}

	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, model.RoleOwner); !ok {
		return
	}

	userIDStr := r.PathValue("userID")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}

	// Last-owner protection
	membership, err := h.queries.GetMembership(r.Context(), db.GetMembershipParams{
		TeamID: teamID,
		UserID: userID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "member not found")
		return
	}

	if membership.Role == string(model.RoleOwner) {
		count, err := h.queries.CountOwners(r.Context(), teamID)
		if err != nil {
			h.logger.Error("failed to count owners", "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if count <= 1 {
			respond.Error(w, http.StatusBadRequest, "cannot remove the last owner")
			return
		}
	}

	if err := h.queries.DeleteMembership(r.Context(), db.DeleteMembershipParams{
		TeamID: teamID,
		UserID: userID,
	}); err != nil {
		h.logger.Error("failed to remove member", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	authCtx := middleware.GetAuthContext(r)
	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "member.remove",
		ResourceType: "member",
		ResourceID:   &userID,
		IPAddress:    ip,
	})

	w.WriteHeader(http.StatusNoContent)
}
