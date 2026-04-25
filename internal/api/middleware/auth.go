package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
)

type ctxKeyAuth struct{}

func Auth(queries *db.Queries, sessions *auth.SessionManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authCtx, ok := authenticate(r, queries, sessions)
			if !ok {
				respond.Error(w, http.StatusUnauthorized, "authentication required")
				return
			}
			ctx := context.WithValue(r.Context(), ctxKeyAuth{}, authCtx)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func authenticate(r *http.Request, queries *db.Queries, sessions *auth.SessionManager) (*model.AuthContext, bool) {
	// Try Bearer token first
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		plain := strings.TrimPrefix(header, "Bearer ")
		hash := auth.HashToken(plain)
		token, err := queries.GetAPITokenByHash(r.Context(), hash)
		if err != nil {
			return nil, false
		}
		// Check expiry
		if token.ExpiresAt.Valid && token.ExpiresAt.Time.Before(time.Now()) {
			return nil, false
		}
		// Update last used async
		go func() {
			_ = queries.UpdateTokenLastUsed(context.Background(), token.ID)
		}()
		return &model.AuthContext{
			UserID:  token.UserID,
			TeamID:  &token.TeamID,
			TokenID: &token.ID,
			Scopes:  token.Scopes,
		}, true
	}

	// Try session cookie or websocket-only query param.
	var sessionToken string
	cookie, err := r.Cookie("session")
	if err == nil {
		sessionToken = cookie.Value
	} else if isWebSocketUpgrade(r) {
		token := r.URL.Query().Get("session_token")
		sessionToken = token
	}
	if sessionToken == "" {
		return nil, false
	}
	session, err := sessions.Get(r.Context(), sessionToken)
	if err != nil {
		return nil, false
	}
	return &model.AuthContext{
		UserID: session.UserID,
	}, true
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func GetAuthContext(r *http.Request) *model.AuthContext {
	if ac, ok := r.Context().Value(ctxKeyAuth{}).(*model.AuthContext); ok {
		return ac
	}
	return nil
}
