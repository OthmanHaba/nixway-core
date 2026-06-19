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

// envVarFixture spins up a team, cluster, project, and app, returning the IDs
// plus the auto-created production environment ID. Shared by the env-var tests.
type envVarFixture struct {
	teamID    string
	projectID string
	appID     string
	prodEnvID string
}

func setupEnvVarFixture(t *testing.T, env *TestEnv, emailAddr string) envVarFixture {
	t.Helper()
	env.SignupAndLogin(env.Client, emailAddr, "password123!", "EnvVar User")
	teamID := env.CreateTeamAsUser(env.Client, "envvar-team")

	resp := env.Post("/api/v1/teams/"+teamID+"/clusters", map[string]string{
		"name": "envvar-cluster", "region": "us-east-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	cluster := ReadJSONMap(t, resp)

	resp = env.Post("/api/v1/teams/"+teamID+"/projects", map[string]any{
		"cluster_id": cluster["id"], "name": "EnvVar Project",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	project := ReadJSONMap(t, resp)
	projectID := project["id"].(string)

	resp = env.Get("/api/v1/projects/" + projectID + "/environments")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var envs []map[string]any
	ReadJSON(t, resp, &envs)
	require.Len(t, envs, 1)
	prodEnvID := envs[0]["id"].(string)

	resp = env.Post("/api/v1/projects/"+projectID+"/apps", map[string]any{
		"name": "envvar-app", "source_type": "docker_image",
		"docker_image": "nginx:latest", "port": 80,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	app := ReadJSONMap(t, resp)

	return envVarFixture{
		teamID:    teamID,
		projectID: projectID,
		appID:     app["id"].(string),
		prodEnvID: prodEnvID,
	}
}

// TestAppEnvVarCRUD covers create, list, reveal, update, and delete via the API.
func TestAppEnvVarCRUD(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envcrud@test.com")

	// --- Create ---
	resp := env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "production",
		"key":         "API_BASE_URL",
		"value":       "https://api.example.com",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	created := ReadJSONMap(t, resp)
	assert.NotEmpty(t, created["id"])
	assert.Equal(t, "API_BASE_URL", created["key"])
	assert.Nil(t, created["value"], "value must not be in response")
	assert.Nil(t, created["encrypted_value"], "ciphertext must not be in response")
	varID := created["id"].(string)

	// --- List ---
	resp = env.Get(fmt.Sprintf("/api/v1/apps/%s/env-vars?environment=production", fx.appID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var vars []map[string]any
	ReadJSON(t, resp, &vars)
	require.Len(t, vars, 1)
	assert.Equal(t, "API_BASE_URL", vars[0]["key"])

	// --- Reveal (repeatable, unlike secrets) ---
	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s/reveal", fx.appID, varID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	revealed := ReadJSONMap(t, resp)
	assert.Equal(t, "https://api.example.com", revealed["value"])

	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s/reveal", fx.appID, varID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode, "reveal should be repeatable")
	resp.Body.Close()

	// --- Update value ---
	resp = env.Put(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s", fx.appID, varID), map[string]string{
		"value": "https://api2.example.com",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s/reveal", fx.appID, varID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	revealed = ReadJSONMap(t, resp)
	assert.Equal(t, "https://api2.example.com", revealed["value"], "update should change the value")

	// --- Delete ---
	resp = env.Delete(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s", fx.appID, varID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	resp = env.Get(fmt.Sprintf("/api/v1/apps/%s/env-vars?environment=production", fx.appID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	ReadJSON(t, resp, &vars)
	assert.Len(t, vars, 0, "variable should be gone after delete")
}

// TestAppEnvVarEncryptedAtRest verifies the DB stores ciphertext, not plaintext.
func TestAppEnvVarEncryptedAtRest(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envenc@test.com")

	plaintext := "plaintext-value-that-must-be-encrypted"
	resp := env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "production",
		"key":         "SECRET_TOKEN",
		"value":       plaintext,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	appUUID := uuid.MustParse(fx.appID)
	envUUID := uuid.MustParse(fx.prodEnvID)
	rows, err := env.Queries.ListAppEnvVarsWithValues(env.Ctx, db.ListAppEnvVarsWithValuesParams{
		AppID:         appUUID,
		EnvironmentID: envUUID,
	})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.NotEqual(t, plaintext, string(rows[0].EncryptedValue), "DB must store ciphertext")
	assert.Greater(t, len(rows[0].EncryptedValue), len(plaintext), "ciphertext carries nonce + overhead")
}

// TestAppEnvVarEnvironmentScoping verifies the same key in two environments is
// independent and reveals its own value.
func TestAppEnvVarEnvironmentScoping(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envscope2@test.com")

	// Add a staging environment.
	resp := env.Post("/api/v1/projects/"+fx.projectID+"/environments", map[string]string{
		"name": "Staging",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Same key, different value, in each environment.
	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "production", "key": "DB_HOST", "value": "prod-db.internal",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	prodVar := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "staging", "key": "DB_HOST", "value": "staging-db.internal",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	stagingVar := ReadJSONMap(t, resp)

	assert.NotEqual(t, prodVar["id"], stagingVar["id"], "different environments → different rows")

	// Each environment lists exactly one.
	for _, slug := range []string{"production", "staging"} {
		resp = env.Get(fmt.Sprintf("/api/v1/apps/%s/env-vars?environment=%s", fx.appID, slug))
		require.Equal(t, http.StatusOK, resp.StatusCode)
		var vars []map[string]any
		ReadJSON(t, resp, &vars)
		assert.Len(t, vars, 1, "environment %s should have one var", slug)
	}

	// Reveal production → prod value.
	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s/reveal", fx.appID, prodVar["id"]), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "prod-db.internal", ReadJSONMap(t, resp)["value"])
}

// TestAppEnvVarReservedKeyRejected verifies platform-reserved keys are rejected.
func TestAppEnvVarReservedKeyRejected(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envreserved@test.com")

	for _, key := range []string{"PORT", "APP_NAME", "DEPLOY_ID"} {
		resp := env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
			"environment": "production", "key": key, "value": "nope",
		})
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "reserved key %s must be rejected", key)
		resp.Body.Close()
	}
}

// TestAppEnvVarInvalidKeyRejected verifies malformed keys are rejected.
func TestAppEnvVarInvalidKeyRejected(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envinvalid@test.com")

	for _, key := range []string{"1BAD", "has-dash", "has space", ""} {
		resp := env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
			"environment": "production", "key": key, "value": "v",
		})
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "invalid key %q must be rejected", key)
		resp.Body.Close()
	}
}

// TestAppEnvVarUpsert verifies that re-creating the same key updates in place
// rather than creating a duplicate (set semantics).
func TestAppEnvVarUpsert(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envupsert@test.com")

	resp := env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "production", "key": "FEATURE_FLAG", "value": "off",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	first := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "production", "key": "FEATURE_FLAG", "value": "on",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	second := ReadJSONMap(t, resp)
	assert.Equal(t, first["id"], second["id"], "upsert must reuse the same row")

	// Still exactly one var, and it holds the latest value.
	resp = env.Get(fmt.Sprintf("/api/v1/apps/%s/env-vars?environment=production", fx.appID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var vars []map[string]any
	ReadJSON(t, resp, &vars)
	require.Len(t, vars, 1)

	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s/reveal", fx.appID, first["id"]), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "on", ReadJSONMap(t, resp)["value"])
}

// TestAppEnvVarUnknownEnvironment verifies an unknown environment slug 404s.
func TestAppEnvVarUnknownEnvironment(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envunknown@test.com")

	resp := env.Get(fmt.Sprintf("/api/v1/apps/%s/env-vars?environment=ghost", fx.appID))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()

	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "ghost", "key": "X", "value": "y",
	})
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestAppEnvVarCrossAppIsolation verifies a var on one app is invisible and
// unreachable through another app's routes.
func TestAppEnvVarCrossAppIsolation(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "enviso@test.com")

	// Second app in the same project.
	resp := env.Post("/api/v1/projects/"+fx.projectID+"/apps", map[string]any{
		"name": "other-app", "source_type": "docker_image",
		"docker_image": "redis:latest", "port": 6379,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	otherApp := ReadJSONMap(t, resp)
	otherAppID := otherApp["id"].(string)

	// Create a var on the first app.
	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), map[string]string{
		"environment": "production", "key": "PRIVATE", "value": "app-a-only",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	varID := ReadJSONMap(t, resp)["id"].(string)

	// Other app sees nothing.
	resp = env.Get(fmt.Sprintf("/api/v1/apps/%s/env-vars?environment=production", otherAppID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var vars []map[string]any
	ReadJSON(t, resp, &vars)
	assert.Len(t, vars, 0)

	// Revealing app A's var through app B's path 404s (scoped by app_id).
	resp = env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars/%s/reveal", otherAppID, varID), nil)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestAppEnvVarBuildPrecedence verifies the headline decision: at build time,
// app-level vars OVERRIDE team secrets, while secret-only and app-only keys are
// both present in the resolved build env.
func TestAppEnvVarBuildPrecedence(t *testing.T) {
	env := SetupTestEnv(t)
	fx := setupEnvVarFixture(t, env, "envprec@test.com")

	// Team secrets for production.
	for _, s := range []map[string]string{
		{"environment": "production", "key": "SHARED", "value": "from-secret"},
		{"environment": "production", "key": "ONLY_SECRET", "value": "secret-value"},
	} {
		resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/secrets", fx.teamID), s)
		require.Equal(t, http.StatusCreated, resp.StatusCode)
		resp.Body.Close()
	}

	// App-level vars: one collides with a secret, one is app-only.
	for _, v := range []map[string]string{
		{"environment": "production", "key": "SHARED", "value": "from-app"},
		{"environment": "production", "key": "ONLY_APP", "value": "app-value"},
	} {
		resp := env.Post(fmt.Sprintf("/api/v1/apps/%s/env-vars", fx.appID), v)
		require.Equal(t, http.StatusCreated, resp.StatusCode)
		resp.Body.Close()
	}

	app, err := env.Queries.GetApp(env.Ctx, uuid.MustParse(fx.appID))
	require.NoError(t, err)

	resolved := env.BuildSvc.ResolveBuildEnv(
		env.Ctx, app, uuid.MustParse(fx.prodEnvID), uuid.MustParse(fx.teamID),
	)

	assert.Equal(t, "from-app", resolved["SHARED"], "app var must override team secret")
	assert.Equal(t, "secret-value", resolved["ONLY_SECRET"], "secret-only key must be present")
	assert.Equal(t, "app-value", resolved["ONLY_APP"], "app-only key must be present")
}
