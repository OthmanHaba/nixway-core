package github

import (
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGenerateManifest_UsesTeamScopedWebhookURL(t *testing.T) {
	svc := NewService(DefaultGitHubBaseURL, DefaultGitHubAPIURL, "https://hooks.example.test", "https://app.example.test", slog.Default())

	manifest := svc.GenerateManifest("team-123", "acme")

	hookAttrs := manifest["hook_attributes"].(map[string]any)
	assert.Equal(t, "https://hooks.example.test/api/v1/webhooks/github/team/team-123", hookAttrs["url"])

	perms := manifest["default_permissions"].(map[string]any)
	assert.Equal(t, "read", perms["contents"])
	assert.Equal(t, "read", perms["metadata"])
	assert.Equal(t, "read", perms["pull_requests"])
	_, hasWebhooks := perms["webhooks"]
	assert.False(t, hasWebhooks, "webhooks is not a valid GitHub App permission")
}
