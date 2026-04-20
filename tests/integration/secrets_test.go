package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSecretCRUD verifies secret create, list, get, update, and delete via the API.
func TestSecretCRUD(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "secret@example.com", "password123", "Secret User")
	teamID := env.CreateTeamAsUser(env.Client, "secret-test-team")

	// --- Create secret ---
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "production",
		"key":         "DATABASE_URL",
		"value":       "postgres://user:pass@db:5432/app",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	secretData := ReadJSONMap(t, resp)
	assert.NotEmpty(t, secretData["id"])
	assert.Equal(t, "production", secretData["environment"])
	assert.Equal(t, "DATABASE_URL", secretData["key"])
	assert.Equal(t, float64(1), secretData["version"])
	assert.Nil(t, secretData["value"], "value should not be in response")
	assert.Nil(t, secretData["encrypted_value"], "encrypted_value should not be in response")
	secretID := secretData["id"].(string)

	// --- List secrets ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/secrets?environment=production", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var secrets []map[string]any
	ReadJSON(t, resp, &secrets)
	require.Len(t, secrets, 1)
	assert.Equal(t, "DATABASE_URL", secrets[0]["key"])

	// --- Get secret metadata ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/secrets/%s", teamID, secretID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	getData := ReadJSONMap(t, resp)
	assert.Equal(t, "DATABASE_URL", getData["key"])
	assert.Nil(t, getData["value"])

	// --- Update secret ---
	resp = env.Put(fmt.Sprintf("/api/v1/teams/%s/secrets/%s", teamID, secretID), map[string]string{
		"value": "postgres://new:pass@db:5432/app",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	updated := ReadJSONMap(t, resp)
	assert.Equal(t, float64(2), updated["version"])

	// --- Delete secret ---
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/secrets/%s", teamID, secretID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- Verify deleted ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/secrets/%s", teamID, secretID))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestSecretRevealOnce verifies that secrets can only be revealed once per version.
func TestSecretRevealOnce(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "reveal@example.com", "password123", "Reveal User")
	teamID := env.CreateTeamAsUser(env.Client, "reveal-test-team")

	// Create secret
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "production",
		"key":         "API_KEY",
		"value":       "sk-secret-123",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	secretData := ReadJSONMap(t, resp)
	secretID := secretData["id"].(string)

	// --- First reveal should succeed ---
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets/%s/reveal", teamID, secretID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	revealData := ReadJSONMap(t, resp)
	assert.Equal(t, "sk-secret-123", revealData["value"])

	// --- Second reveal should fail (already revealed) ---
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets/%s/reveal", teamID, secretID), nil)
	assert.Equal(t, http.StatusConflict, resp.StatusCode)
	resp.Body.Close()

	// --- Update secret (resets revealed_at, increments version) ---
	resp = env.Put(fmt.Sprintf("/api/v1/teams/%s/secrets/%s", teamID, secretID), map[string]string{
		"value": "sk-new-key-456",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	updated := ReadJSONMap(t, resp)
	assert.Equal(t, float64(2), updated["version"])

	// --- Reveal should work again after update ---
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets/%s/reveal", teamID, secretID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	revealData = ReadJSONMap(t, resp)
	assert.Equal(t, "sk-new-key-456", revealData["value"])
}

// TestSecretEncryptedAtRest verifies that the DB stores ciphertext, not plaintext.
func TestSecretEncryptedAtRest(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "encrypted@example.com", "password123", "Encrypted User")
	teamID := env.CreateTeamAsUser(env.Client, "encrypted-test-team")
	teamUUID, _ := uuid.Parse(teamID)

	plaintext := "super-secret-value-that-should-be-encrypted"

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "staging",
		"key":         "SECRET_TOKEN",
		"value":       plaintext,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Read from DB directly
	secret, err := env.Queries.GetSecretByKey(env.Ctx, db.GetSecretByKeyParams{
		TeamID:      teamUUID,
		Environment: "staging",
		Key:         "SECRET_TOKEN",
	})
	require.NoError(t, err)
	assert.NotEqual(t, plaintext, string(secret.EncryptedValue), "DB should store ciphertext, not plaintext")
	assert.True(t, len(secret.EncryptedValue) > len(plaintext), "ciphertext should be longer than plaintext (nonce + overhead)")
}

// TestSecretEnvironmentScoping verifies same key in different environments are independent.
func TestSecretEnvironmentScoping(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "envscope@example.com", "password123", "EnvScope User")
	teamID := env.CreateTeamAsUser(env.Client, "envscope-test-team")

	// Create same key in production
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "production",
		"key":         "DB_HOST",
		"value":       "prod-db.internal",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	prodSecret := ReadJSONMap(t, resp)

	// Create same key in staging
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "staging",
		"key":         "DB_HOST",
		"value":       "staging-db.internal",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	stagingSecret := ReadJSONMap(t, resp)

	// They should be different records
	assert.NotEqual(t, prodSecret["id"], stagingSecret["id"])

	// List production — should have 1
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/secrets?environment=production", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var prodSecrets []map[string]any
	ReadJSON(t, resp, &prodSecrets)
	assert.Len(t, prodSecrets, 1)

	// List staging — should have 1
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/secrets?environment=staging", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var stagingSecrets []map[string]any
	ReadJSON(t, resp, &stagingSecrets)
	assert.Len(t, stagingSecrets, 1)

	// Reveal production — should get prod value
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets/%s/reveal", teamID, prodSecret["id"]), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	revealData := ReadJSONMap(t, resp)
	assert.Equal(t, "prod-db.internal", revealData["value"])
}

// TestSecretRevealAuditLog verifies that revealing a secret creates an audit log entry.
func TestSecretRevealAuditLog(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "auditreveal@example.com", "password123", "AuditReveal User")
	teamID := env.CreateTeamAsUser(env.Client, "auditreveal-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "production",
		"key":         "AUDIT_KEY",
		"value":       "audit-value",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	secretData := ReadJSONMap(t, resp)
	secretID := secretData["id"].(string)
	secretUUID, _ := uuid.Parse(secretID)

	// Reveal
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets/%s/reveal", teamID, secretID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check secret_access_log
	count, err := env.Queries.CountSecretAccessLogs(env.Ctx, secretUUID)
	require.NoError(t, err)
	assert.True(t, count > 0, "should have at least one access log entry after reveal")
}

// TestSecretDuplicateKeyRejected verifies that duplicate key+environment is rejected.
func TestSecretDuplicateKeyRejected(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "dupekey@example.com", "password123", "DupeKey User")
	teamID := env.CreateTeamAsUser(env.Client, "dupekey-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "production",
		"key":         "SAME_KEY",
		"value":       "first-value",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Same key+env should fail
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", teamID), map[string]string{
		"environment": "production",
		"key":         "SAME_KEY",
		"value":       "second-value",
	})
	assert.NotEqual(t, http.StatusCreated, resp.StatusCode, "duplicate key+env should be rejected")
	resp.Body.Close()
}
