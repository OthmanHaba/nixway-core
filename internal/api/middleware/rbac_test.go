package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/stretchr/testify/assert"
)

func TestTokenHasScope(t *testing.T) {
	tests := []struct {
		name     string
		scopes   []string
		required string
		want     bool
	}{
		{
			name:     "exact scope",
			scopes:   []string{model.ScopeTeamsRead},
			required: model.ScopeTeamsRead,
			want:     true,
		},
		{
			name:     "wrong exact scope",
			scopes:   []string{model.ScopeTeamsRead},
			required: model.ScopeTeamsWrite,
			want:     false,
		},
		{
			name:     "resource wildcard",
			scopes:   []string{"teams:*"},
			required: model.ScopeTeamsWrite,
			want:     true,
		},
		{
			name:     "resource wildcard does not cross resource",
			scopes:   []string{"teams:*"},
			required: model.ScopeMembersRead,
			want:     false,
		},
		{
			name:     "global wildcard",
			scopes:   []string{model.ScopeAll},
			required: model.ScopeAuditRead,
			want:     true,
		},
		{
			name:     "empty token scopes",
			scopes:   nil,
			required: model.ScopeTokensRead,
			want:     false,
		},
		{
			name:     "empty required scope",
			scopes:   nil,
			required: "",
			want:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, TokenHasScope(tt.scopes, tt.required))
		})
	}
}

func TestIsWebSocketUpgrade(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/apps/app/terminal?session_token=abc", nil)
	assert.False(t, isWebSocketUpgrade(req))

	req.Header.Set("Upgrade", "websocket")
	assert.True(t, isWebSocketUpgrade(req))
}
