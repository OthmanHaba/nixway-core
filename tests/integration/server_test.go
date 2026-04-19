package integration

import (
	"fmt"
	"net/http"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSSHKeyCRUD verifies SSH key create, list, and delete via the API.
func TestSSHKeyCRUD(t *testing.T) {
	env := SetupTestEnv(t)

	// Sign up, verify, login
	env.SignupAndLogin(env.Client, "sshkey@example.com", "password123", "SSH User")

	// Create team
	teamID := env.CreateTeamAsUser(env.Client, "ssh-test-team")

	// --- Create SSH key ---
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/ssh-keys", teamID), map[string]string{
		"name":     "test-key",
		"key_type": "ed25519",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode,
		"create ssh key should return 201")
	keyData := ReadJSONMap(t, resp)
	assert.NotEmpty(t, keyData["id"])
	assert.NotEmpty(t, keyData["fingerprint"])
	assert.NotEmpty(t, keyData["public_key"])
	assert.Equal(t, "ed25519", keyData["key_type"])
	assert.Equal(t, "test-key", keyData["name"])
	keyID := keyData["id"].(string)

	// --- List SSH keys ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/ssh-keys", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var keys []map[string]any
	ReadJSON(t, resp, &keys)
	require.Len(t, keys, 1)
	assert.Equal(t, keyID, keys[0]["id"])

	// --- Delete SSH key ---
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/ssh-keys/%s", teamID, keyID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- Verify empty list ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/ssh-keys", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var emptyKeys []map[string]any
	ReadJSON(t, resp, &emptyKeys)
	assert.Len(t, emptyKeys, 0)
}

// insertTestServer inserts a server directly into the DB for testing.
func insertTestServer(t *testing.T, env *TestEnv, teamID uuid.UUID) db.Server {
	t.Helper()
	srv, err := env.Queries.CreateServer(env.Ctx, db.CreateServerParams{
		TeamID:   teamID,
		Name:     "test-server",
		Hostname: "test.example.com",
		PublicIp: netip.MustParseAddr("10.0.0.1"),
		SshPort:  22,
		SshUser:  "root",
		Status:   "online",
	})
	require.NoError(t, err)
	return srv
}

// TestServerTagCRUD verifies tag set, list, and delete via the API.
func TestServerTagCRUD(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "tag@example.com", "password123", "Tag User")
	teamID := env.CreateTeamAsUser(env.Client, "tag-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)
	serverID := srv.ID.String()

	// --- Set tag ---
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags", teamID, serverID), map[string]string{
		"key":   "env",
		"value": "prod",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode, "set tag should return 200")
	tagData := ReadJSONMap(t, resp)
	assert.Equal(t, "env", tagData["key"])
	assert.Equal(t, "prod", tagData["value"])

	// --- List tags ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags", teamID, serverID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var tags []map[string]any
	ReadJSON(t, resp, &tags)
	require.Len(t, tags, 1)
	assert.Equal(t, "env", tags[0]["key"])
	assert.Equal(t, "prod", tags[0]["value"])

	// --- Delete tag ---
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags/env", teamID, serverID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- Verify empty ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags", teamID, serverID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var emptyTags []map[string]any
	ReadJSON(t, resp, &emptyTags)
	assert.Len(t, emptyTags, 0)
}

// TestProvisioningJobCreation verifies provisioning job creation and status query.
func TestProvisioningJobCreation(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "prov@example.com", "password123", "Prov User")
	teamID := env.CreateTeamAsUser(env.Client, "prov-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)
	serverID := srv.ID.String()

	// --- Start provisioning ---
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/provision", teamID, serverID), map[string]any{
		"components": []string{"docker", "traefik"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode,
		"start provisioning should return 201")
	jobData := ReadJSONMap(t, resp)
	assert.NotEmpty(t, jobData["id"])
	assert.Equal(t, "pending", jobData["status"])

	// --- Get provisioning status ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s/provision", teamID, serverID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	statusData := ReadJSONMap(t, resp)
	assert.Equal(t, jobData["id"], statusData["id"])
	assert.Equal(t, "pending", statusData["status"])
}

// TestServerStatusTransitions verifies the StatusWatcher correctly transitions
// server status based on last_seen_at timestamps.
func TestServerStatusTransitions(t *testing.T) {
	env := SetupTestEnv(t)

	// Create a team directly in DB (no auth needed for DB-level test)
	env.SignupAndLogin(env.Client, "status@example.com", "password123", "Status User")
	teamID := env.CreateTeamAsUser(env.Client, "status-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Set last_seen_at to 1 minute ago and status to "online"
	oneMinuteAgo := time.Now().Add(-1 * time.Minute)
	err = env.Queries.UpdateServerStatus(env.Ctx, db.UpdateServerStatusParams{
		ID:         srv.ID,
		Status:     "online",
		LastSeenAt: pgtype.Timestamptz{Time: oneMinuteAgo, Valid: true},
	})
	require.NoError(t, err)

	// Run status watcher check
	watcher := server.NewStatusWatcher(env.Queries, env.Logger)
	watcher.Check(env.Ctx)

	// Verify status changed to "offline" (>50s elapsed)
	updated, err := env.Queries.GetServerByID(env.Ctx, db.GetServerByIDParams{
		ID:     srv.ID,
		TeamID: teamUUID,
	})
	require.NoError(t, err)
	assert.Equal(t, "offline", updated.Status,
		"server with last_seen_at 1 minute ago should be offline")
}
