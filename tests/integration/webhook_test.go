package integration

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// insertTestGitHubApp creates a github_app record directly in the DB for testing.
func insertTestGitHubApp(t *testing.T, env *TestEnv, teamID uuid.UUID, appID int64) db.GithubApp {
	t.Helper()

	webhookSecret := "test-webhook-secret"
	encryptedSecret, err := crypto.Encrypt([]byte(webhookSecret), env.MasterKey, "github:"+teamID.String())
	require.NoError(t, err)

	encryptedClientSecret, err := crypto.Encrypt([]byte("client-secret"), env.MasterKey, "github:"+teamID.String())
	require.NoError(t, err)

	encryptedPEM, err := crypto.Encrypt([]byte("fake-pem"), env.MasterKey, "github:"+teamID.String())
	require.NoError(t, err)

	app, err := env.Queries.CreateGitHubApp(env.Ctx, db.CreateGitHubAppParams{
		TeamID:        teamID,
		AppID:         appID,
		AppName:       "test-app",
		AppSlug:       "test-app",
		ClientID:      "Iv1.test123",
		ClientSecret:  encryptedClientSecret,
		PrivateKey:    encryptedPEM,
		WebhookSecret: encryptedSecret,
		HtmlUrl:       "https://github.com/apps/test-app",
	})
	require.NoError(t, err)
	return app
}

// signPayload computes HMAC-SHA256 of the payload using the given secret.
func signPayload(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// TestWebhookValidSignature verifies that a valid HMAC-SHA256 signature is accepted.
func TestWebhookValidSignature(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "webhook@example.com", "password123", "Webhook User")
	teamID := env.CreateTeamAsUser(env.Client, "webhook-test-team")
	teamUUID, _ := uuid.Parse(teamID)

	app := insertTestGitHubApp(t, env, teamUUID, 12345)
	_ = app

	payload := map[string]any{
		"action": "opened",
		"ref":    "refs/heads/main",
	}
	body, _ := json.Marshal(payload)
	signature := signPayload("test-webhook-secret", body)

	req, err := http.NewRequestWithContext(env.Ctx, http.MethodPost,
		env.Server.URL+fmt.Sprintf("/api/v1/webhooks/github/%d", 12345),
		bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", signature)
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", uuid.New().String())

	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode, "valid signature should be accepted")
}

// TestWebhookInvalidSignature verifies that an invalid signature is rejected with 401.
func TestWebhookInvalidSignature(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "webhookbad@example.com", "password123", "WebhookBad User")
	teamID := env.CreateTeamAsUser(env.Client, "webhookbad-test-team")
	teamUUID, _ := uuid.Parse(teamID)

	insertTestGitHubApp(t, env, teamUUID, 67890)

	payload := []byte(`{"action":"opened"}`)

	req, err := http.NewRequestWithContext(env.Ctx, http.MethodPost,
		env.Server.URL+fmt.Sprintf("/api/v1/webhooks/github/%d", 67890),
		bytes.NewReader(payload))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", "sha256=invalid-signature")
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", uuid.New().String())

	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode, "invalid signature should be rejected")
}

// TestWebhookMissingSignature verifies that a missing signature is rejected with 401.
func TestWebhookMissingSignature(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "webhookmiss@example.com", "password123", "WebhookMiss User")
	teamID := env.CreateTeamAsUser(env.Client, "webhookmiss-test-team")
	teamUUID, _ := uuid.Parse(teamID)

	insertTestGitHubApp(t, env, teamUUID, 11111)

	req, err := http.NewRequestWithContext(env.Ctx, http.MethodPost,
		env.Server.URL+fmt.Sprintf("/api/v1/webhooks/github/%d", 11111),
		bytes.NewReader([]byte(`{}`)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", uuid.New().String())
	// No X-Hub-Signature-256 header

	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode, "missing signature should be rejected")
}

// TestWebhookEventStored verifies that a valid webhook event is stored in the DB.
func TestWebhookEventStored(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "webhookstore@example.com", "password123", "WebhookStore User")
	teamID := env.CreateTeamAsUser(env.Client, "webhookstore-test-team")
	teamUUID, _ := uuid.Parse(teamID)

	app := insertTestGitHubApp(t, env, teamUUID, 22222)

	payload := map[string]any{
		"action": "synchronize",
		"number": 42,
	}
	body, _ := json.Marshal(payload)
	signature := signPayload("test-webhook-secret", body)
	deliveryID := uuid.New().String()

	req, err := http.NewRequestWithContext(env.Ctx, http.MethodPost,
		env.Server.URL+fmt.Sprintf("/api/v1/webhooks/github/%d", 22222),
		bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", signature)
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", deliveryID)

	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Verify event stored in DB
	event, err := env.Queries.GetWebhookEventByDeliveryID(env.Ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, "pull_request", event.EventType)
	assert.Equal(t, app.ID, event.GithubAppID)
}

// TestWebhookDuplicateDeliveryIdempotent verifies duplicate delivery IDs are handled gracefully.
func TestWebhookDuplicateDeliveryIdempotent(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "webhookdupe@example.com", "password123", "WebhookDupe User")
	teamID := env.CreateTeamAsUser(env.Client, "webhookdupe-test-team")
	teamUUID, _ := uuid.Parse(teamID)

	insertTestGitHubApp(t, env, teamUUID, 33333)

	payload := []byte(`{"action":"opened"}`)
	signature := signPayload("test-webhook-secret", payload)
	deliveryID := uuid.New().String()

	sendWebhook := func() *http.Response {
		req, err := http.NewRequestWithContext(env.Ctx, http.MethodPost,
			env.Server.URL+fmt.Sprintf("/api/v1/webhooks/github/%d", 33333),
			bytes.NewReader(payload))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Hub-Signature-256", signature)
		req.Header.Set("X-GitHub-Event", "push")
		req.Header.Set("X-GitHub-Delivery", deliveryID)
		resp, err := env.Client.Do(req)
		require.NoError(t, err)
		return resp
	}

	// First send
	resp := sendWebhook()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Second send with same delivery ID — should still return 200 (idempotent)
	resp = sendWebhook()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()
}

// TestWebhookAppNotFound verifies 404 for non-existent app ID.
func TestWebhookAppNotFound(t *testing.T) {
	env := SetupTestEnv(t)

	req, err := http.NewRequestWithContext(env.Ctx, http.MethodPost,
		env.Server.URL+"/api/v1/webhooks/github/99999",
		bytes.NewReader([]byte(`{}`)))
	require.NoError(t, err)
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", uuid.New().String())
	req.Header.Set("X-Hub-Signature-256", "sha256=whatever")

	resp, err := env.Client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}
