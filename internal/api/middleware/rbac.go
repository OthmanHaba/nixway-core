package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
)

// RequireRole checks that the authenticated user has at least the given role
// on the team identified by teamID (parsed from the URL path).
func RequireRole(queries *db.Queries, teamID uuid.UUID, authCtx *model.AuthContext, minRole model.Role) (model.Role, bool) {
	membership, err := queries.GetMembership(context.Background(), db.GetMembershipParams{
		TeamID: teamID,
		UserID: authCtx.UserID,
	})
	if err != nil {
		return "", false
	}
	role := model.Role(membership.Role)
	if !role.AtLeast(minRole) {
		return role, false
	}
	return role, true
}

func TokenHasScope(scopes []string, required string) bool {
	if required == "" {
		return true
	}
	for _, scope := range scopes {
		if scope == model.ScopeAll || scope == required {
			return true
		}
		if strings.HasSuffix(scope, ":*") {
			prefix := strings.TrimSuffix(scope, "*")
			if strings.HasPrefix(required, prefix) {
				return true
			}
		}
	}
	return false
}

func tokenHasAnyScope(scopes []string, required []string) bool {
	if len(required) == 0 {
		return true
	}
	for _, scope := range required {
		if TokenHasScope(scopes, scope) {
			return true
		}
	}
	return false
}

// CheckTeamRole is a helper that handlers can call. It writes the error response
// and returns false if the check fails.
func CheckTeamRole(w http.ResponseWriter, r *http.Request, queries *db.Queries, teamID uuid.UUID, minRole model.Role, requiredScopes ...string) (model.Role, bool) {
	authCtx := GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return "", false
	}
	if authCtx.TokenID != nil && !tokenHasAnyScope(authCtx.Scopes, requiredScopes) {
		respond.Error(w, http.StatusForbidden, "token scope does not allow this action")
		return "", false
	}
	membership, err := queries.GetMembership(r.Context(), db.GetMembershipParams{
		TeamID: teamID,
		UserID: authCtx.UserID,
	})
	if err != nil {
		respond.Error(w, http.StatusForbidden, "not a member of this team")
		return "", false
	}
	role := model.Role(membership.Role)
	if !role.AtLeast(minRole) {
		respond.Error(w, http.StatusForbidden, "insufficient permissions")
		return role, false
	}
	return role, true
}
