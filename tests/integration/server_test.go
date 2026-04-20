package integration

import (
	"encoding/json"
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

// TestServerStatusDegraded verifies degraded transition (20-50s elapsed).
func TestServerStatusDegraded(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "degraded@example.com", "password123", "Degraded User")
	teamID := env.CreateTeamAsUser(env.Client, "degraded-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Set last_seen_at to 30 seconds ago -> should become "degraded"
	thirtySecsAgo := time.Now().Add(-30 * time.Second)
	err = env.Queries.UpdateServerStatus(env.Ctx, db.UpdateServerStatusParams{
		ID:         srv.ID,
		Status:     "online",
		LastSeenAt: pgtype.Timestamptz{Time: thirtySecsAgo, Valid: true},
	})
	require.NoError(t, err)

	watcher := server.NewStatusWatcher(env.Queries, env.Logger)
	watcher.Check(env.Ctx)

	updated, err := env.Queries.GetServerByID(env.Ctx, db.GetServerByIDParams{
		ID: srv.ID, TeamID: teamUUID,
	})
	require.NoError(t, err)
	assert.Equal(t, "degraded", updated.Status,
		"server with last_seen_at 30s ago should be degraded")
}

// TestServerStatusStaysOnline verifies no transition when heartbeat is recent.
func TestServerStatusStaysOnline(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "online@example.com", "password123", "Online User")
	teamID := env.CreateTeamAsUser(env.Client, "online-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Set last_seen_at to 5 seconds ago -> should stay "online"
	fiveSecsAgo := time.Now().Add(-5 * time.Second)
	err = env.Queries.UpdateServerStatus(env.Ctx, db.UpdateServerStatusParams{
		ID:         srv.ID,
		Status:     "online",
		LastSeenAt: pgtype.Timestamptz{Time: fiveSecsAgo, Valid: true},
	})
	require.NoError(t, err)

	watcher := server.NewStatusWatcher(env.Queries, env.Logger)
	watcher.Check(env.Ctx)

	updated, err := env.Queries.GetServerByID(env.Ctx, db.GetServerByIDParams{
		ID: srv.ID, TeamID: teamUUID,
	})
	require.NoError(t, err)
	assert.Equal(t, "online", updated.Status,
		"server with last_seen_at 5s ago should stay online")
}

// TestSSHKeyRSAGeneration verifies RSA key generation via the API.
func TestSSHKeyRSAGeneration(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "rsa@example.com", "password123", "RSA User")
	teamID := env.CreateTeamAsUser(env.Client, "rsa-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/ssh-keys", teamID), map[string]string{
		"name":     "rsa-key",
		"key_type": "rsa",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	keyData := ReadJSONMap(t, resp)
	assert.Equal(t, "rsa", keyData["key_type"])
	assert.NotEmpty(t, keyData["fingerprint"])
	assert.Contains(t, keyData["public_key"], "ssh-rsa")
}

// TestSSHKeyGetByID verifies getting a single SSH key by ID.
func TestSSHKeyGetByID(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "getkey@example.com", "password123", "GetKey User")
	teamID := env.CreateTeamAsUser(env.Client, "getkey-test-team")

	// Create key
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/ssh-keys", teamID), map[string]string{
		"name":     "get-test-key",
		"key_type": "ed25519",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	keyData := ReadJSONMap(t, resp)
	keyID := keyData["id"].(string)

	// Get by ID
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/ssh-keys/%s", teamID, keyID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	getResult := ReadJSONMap(t, resp)
	assert.Equal(t, keyID, getResult["id"])
	assert.Equal(t, "get-test-key", getResult["name"])
	assert.Equal(t, "ed25519", getResult["key_type"])
}

// TestSSHKeyNotFoundReturns404 verifies 404 for non-existent key.
func TestSSHKeyNotFoundReturns404(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "nokey@example.com", "password123", "NoKey User")
	teamID := env.CreateTeamAsUser(env.Client, "nokey-test-team")

	fakeID := uuid.New().String()
	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/ssh-keys/%s", teamID, fakeID))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestServerListAPI verifies listing servers via the API.
func TestServerListAPI(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvlist@example.com", "password123", "SrvList User")
	teamID := env.CreateTeamAsUser(env.Client, "srvlist-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	// Insert two servers
	insertTestServer(t, env, teamUUID)
	insertTestServerWithName(t, env, teamUUID, "second-server", "10.0.0.2")

	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/servers", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var servers []map[string]any
	ReadJSON(t, resp, &servers)
	assert.Len(t, servers, 2)
}

// TestServerGetAPI verifies getting a single server via the API returns flat JSON.
func TestServerGetAPI(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvget@example.com", "password123", "SrvGet User")
	teamID := env.CreateTeamAsUser(env.Client, "srvget-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	data := ReadJSONMap(t, resp)

	// Verify flat JSON response (not nested under "server" key)
	assert.Equal(t, "test-server", data["name"])
	assert.Equal(t, "test.example.com", data["hostname"])
	assert.Equal(t, "10.0.0.1", data["public_ip"])
	assert.Equal(t, float64(22), data["ssh_port"])
	assert.Equal(t, "root", data["ssh_user"])
	assert.Equal(t, "online", data["status"])
}

// TestServerGetNotFound verifies 404 for non-existent server.
func TestServerGetNotFound(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvnotfound@example.com", "password123", "NF User")
	teamID := env.CreateTeamAsUser(env.Client, "nf-test-team")

	fakeID := uuid.New().String()
	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, fakeID))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestServerDeleteAPI verifies deleting a server via the API.
func TestServerDeleteAPI(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvdel@example.com", "password123", "SrvDel User")
	teamID := env.CreateTeamAsUser(env.Client, "srvdel-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Delete
	resp := env.Delete(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Verify gone
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()

	// Verify list is empty
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/servers", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var servers []map[string]any
	ReadJSON(t, resp, &servers)
	assert.Len(t, servers, 0)
}

// TestServerGetWithResources verifies the server detail API includes resources.
func TestServerGetWithResources(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvres@example.com", "password123", "SrvRes User")
	teamID := env.CreateTeamAsUser(env.Client, "srvres-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Insert resource data directly
	cpuModel := "Intel Xeon E5-2680"
	cpuCores := int32(8)
	memTotal := int64(17179869184)  // 16 GB
	memAvail := int64(8589934592)   // 8 GB
	kernelVer := "6.8.0-44-generic"
	dockerVer := "27.1.1"

	err = env.Queries.UpsertServerResources(env.Ctx, db.UpsertServerResourcesParams{
		ServerID:        srv.ID,
		CpuModel:        &cpuModel,
		CpuCores:        &cpuCores,
		MemoryTotal:     &memTotal,
		MemoryAvailable: &memAvail,
		KernelVersion:   &kernelVer,
		DockerVersion:   &dockerVer,
		Disks:           json.RawMessage(`[{"mount":"/","total_bytes":107374182400,"used_bytes":21474836480}]`),
		NetworkInterfaces: json.RawMessage(`[{"name":"eth0","ips":["10.0.0.1"]}]`),
	})
	require.NoError(t, err)

	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	data := ReadJSONMap(t, resp)

	// Verify server fields
	assert.Equal(t, "test-server", data["name"])

	// Verify resources are included
	resources, ok := data["resources"].(map[string]any)
	require.True(t, ok, "resources should be present in server detail response")
	assert.Equal(t, "Intel Xeon E5-2680", resources["cpu_model"])
	assert.Equal(t, float64(8), resources["cpu_cores"])
	assert.Equal(t, float64(17179869184), resources["memory_total"])
	assert.Equal(t, float64(8589934592), resources["memory_available"])
	assert.Equal(t, "6.8.0-44-generic", resources["kernel_version"])
	assert.Equal(t, "27.1.1", resources["docker_version"])
}

// TestServerListWithTagFilter verifies server list filters by tag.
func TestServerListWithTagFilter(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "tagfilter@example.com", "password123", "TagFilter User")
	teamID := env.CreateTeamAsUser(env.Client, "tagfilter-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv1 := insertTestServerWithName(t, env, teamUUID, "prod-server", "10.0.0.10")
	srv2 := insertTestServerWithName(t, env, teamUUID, "staging-server", "10.0.0.11")

	// Tag srv1 as prod
	_, err = env.Queries.SetServerTag(env.Ctx, db.SetServerTagParams{
		ServerID: srv1.ID, Key: "env", Value: "prod",
	})
	require.NoError(t, err)

	// Tag srv2 as staging
	_, err = env.Queries.SetServerTag(env.Ctx, db.SetServerTagParams{
		ServerID: srv2.ID, Key: "env", Value: "staging",
	})
	require.NoError(t, err)

	// Filter by tag=env:prod
	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/servers?tag=env:prod", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var servers []map[string]any
	ReadJSON(t, resp, &servers)
	require.Len(t, servers, 1)
	assert.Equal(t, "prod-server", servers[0]["name"])
}

// TestServerTagUpsert verifies that setting a tag with the same key updates the value.
func TestServerTagUpsert(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "tagupsert@example.com", "password123", "TagUpsert User")
	teamID := env.CreateTeamAsUser(env.Client, "tagupsert-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)
	serverID := srv.ID.String()

	// Set tag
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags", teamID, serverID), map[string]string{
		"key": "env", "value": "staging",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Update same key with new value
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags", teamID, serverID), map[string]string{
		"key": "env", "value": "prod",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// List tags - should have only 1 entry with updated value
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/servers/%s/tags", teamID, serverID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var tags []map[string]any
	ReadJSON(t, resp, &tags)
	require.Len(t, tags, 1)
	assert.Equal(t, "env", tags[0]["key"])
	assert.Equal(t, "prod", tags[0]["value"])
}

// TestProvisioningInvalidComponent verifies that invalid component names are rejected.
func TestProvisioningInvalidComponent(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "badcomp@example.com", "password123", "BadComp User")
	teamID := env.CreateTeamAsUser(env.Client, "badcomp-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/provision", teamID, srv.ID.String()), map[string]any{
		"components": []string{"docker", "invalid-component"},
	})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// TestProvisioningEmptyComponents verifies that empty components list is rejected.
func TestProvisioningEmptyComponents(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "emptycomp@example.com", "password123", "EmptyComp User")
	teamID := env.CreateTeamAsUser(env.Client, "emptycomp-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/provision", teamID, srv.ID.String()), map[string]any{
		"components": []string{},
	})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// TestProvisioningRetry verifies that retry creates a new job with same components.
func TestProvisioningRetry(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "retry@example.com", "password123", "Retry User")
	teamID := env.CreateTeamAsUser(env.Client, "retry-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)
	serverID := srv.ID.String()

	// Start initial provisioning
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/provision", teamID, serverID), map[string]any{
		"components": []string{"docker", "nixpacks"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	job1 := ReadJSONMap(t, resp)
	job1ID := job1["id"].(string)

	// Retry
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/servers/%s/provision/retry", teamID, serverID), nil)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	job2 := ReadJSONMap(t, resp)

	// Retry creates a different job
	assert.NotEqual(t, job1ID, job2["id"])
	assert.Equal(t, "pending", job2["status"])
}

// TestServerDeleteCascadesTags verifies that deleting a server cleans up tags.
func TestServerDeleteCascadesTags(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "cascade@example.com", "password123", "Cascade User")
	teamID := env.CreateTeamAsUser(env.Client, "cascade-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Add tags
	_, err = env.Queries.SetServerTag(env.Ctx, db.SetServerTagParams{
		ServerID: srv.ID, Key: "env", Value: "prod",
	})
	require.NoError(t, err)

	// Delete server
	resp := env.Delete(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Tags should be gone (CASCADE)
	tags, err := env.Queries.ListServerTags(env.Ctx, srv.ID)
	require.NoError(t, err)
	assert.Len(t, tags, 0)
}

// TestServerDeleteCascadesResources verifies that deleting a server cleans up resources.
func TestServerDeleteCascadesResources(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "cascres@example.com", "password123", "CascRes User")
	teamID := env.CreateTeamAsUser(env.Client, "cascres-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Insert resources
	cpuModel := "AMD EPYC"
	cpuCores := int32(4)
	memTotal := int64(8589934592)
	memAvail := int64(4294967296)
	err = env.Queries.UpsertServerResources(env.Ctx, db.UpsertServerResourcesParams{
		ServerID:    srv.ID,
		CpuModel:    &cpuModel,
		CpuCores:    &cpuCores,
		MemoryTotal: &memTotal,
		MemoryAvailable: &memAvail,
	})
	require.NoError(t, err)

	// Delete server
	resp := env.Delete(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Resources should be gone (CASCADE)
	_, err = env.Queries.GetServerResources(env.Ctx, srv.ID)
	assert.Error(t, err, "resources should be deleted when server is deleted")
}

// TestUnauthenticatedAccessDenied verifies that unauthenticated requests are rejected.
func TestUnauthenticatedAccessDenied(t *testing.T) {
	env := SetupTestEnv(t)

	fakeTeamID := uuid.New().String()

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{"list servers", "GET", fmt.Sprintf("/api/v1/teams/%s/servers", fakeTeamID)},
		{"list ssh keys", "GET", fmt.Sprintf("/api/v1/teams/%s/ssh-keys", fakeTeamID)},
		{"create ssh key", "POST", fmt.Sprintf("/api/v1/teams/%s/ssh-keys", fakeTeamID)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Use a fresh client with no session
			noAuthClient := env.NewClientWithJar()
			var resp *http.Response
			switch tt.method {
			case "GET":
				resp = env.GetWith(noAuthClient, tt.path)
			case "POST":
				resp = env.PostWith(noAuthClient, tt.path, map[string]string{})
			}
			assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
				"%s should return 401 for unauthenticated requests", tt.name)
			resp.Body.Close()
		})
	}
}

// TestServerAuditLogging verifies that server create and delete produce audit log entries.
func TestServerAuditLogging(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvaudit@example.com", "password123", "SrvAudit User")
	teamID := env.CreateTeamAsUser(env.Client, "srvaudit-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	srv := insertTestServer(t, env, teamUUID)

	// Delete server (this creates an audit entry)
	resp := env.Delete(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check audit logs
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/audit-logs", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var logs []map[string]any
	ReadJSON(t, resp, &logs)

	// Find server.delete action
	found := false
	for _, log := range logs {
		if log["action"] == "server.delete" {
			found = true
			assert.Equal(t, "server", log["resource_type"])
			break
		}
	}
	assert.True(t, found, "audit log should contain server.delete entry")
}

// TestSSHKeyAuditLogging verifies that SSH key operations produce audit log entries.
func TestSSHKeyAuditLogging(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "keyaudit@example.com", "password123", "KeyAudit User")
	teamID := env.CreateTeamAsUser(env.Client, "keyaudit-test-team")

	// Create key
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/ssh-keys", teamID), map[string]string{
		"name": "audit-key", "key_type": "ed25519",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	keyData := ReadJSONMap(t, resp)
	keyID := keyData["id"].(string)

	// Delete key
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/ssh-keys/%s", teamID, keyID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check audit logs
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/audit-logs", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var logs []map[string]any
	ReadJSON(t, resp, &logs)

	actions := make(map[string]bool)
	for _, log := range logs {
		actions[log["action"].(string)] = true
	}
	assert.True(t, actions["ssh_key.create"], "audit log should contain ssh_key.create")
	assert.True(t, actions["ssh_key.delete"], "audit log should contain ssh_key.delete")
}

// insertTestServerWithName inserts a server with a custom name and IP.
func insertTestServerWithName(t *testing.T, env *TestEnv, teamID uuid.UUID, name, ip string) db.Server {
	t.Helper()
	srv, err := env.Queries.CreateServer(env.Ctx, db.CreateServerParams{
		TeamID:   teamID,
		Name:     name,
		Hostname: name + ".example.com",
		PublicIp: netip.MustParseAddr(ip),
		SshPort:  22,
		SshUser:  "root",
		Status:   "online",
	})
	require.NoError(t, err)
	return srv
}
