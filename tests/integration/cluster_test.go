package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestClusterCRUD verifies cluster create, list, get, update, and delete via the API.
func TestClusterCRUD(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "cluster@example.com", "password123", "Cluster User")
	teamID := env.CreateTeamAsUser(env.Client, "cluster-test-team")

	// --- Create cluster ---
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{
		"name":        "Production US",
		"description": "US East production cluster",
		"region":      "us-east-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, "create cluster should return 201")
	clusterData := ReadJSONMap(t, resp)
	assert.NotEmpty(t, clusterData["id"])
	assert.Equal(t, "Production US", clusterData["name"])
	assert.Equal(t, "production-us", clusterData["slug"])
	assert.Equal(t, "us-east-1", clusterData["region"])
	assert.NotEmpty(t, clusterData["cidr"])
	assert.Equal(t, "active", clusterData["status"])
	clusterID := clusterData["id"].(string)

	// --- List clusters ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var clusters []map[string]any
	ReadJSON(t, resp, &clusters)
	require.Len(t, clusters, 1)
	assert.Equal(t, clusterID, clusters[0]["id"])

	// --- Get cluster ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	getResult := ReadJSONMap(t, resp)
	assert.Equal(t, "Production US", getResult["name"])
	assert.Equal(t, float64(0), getResult["member_count"])

	// --- Update cluster ---
	resp = env.Put(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID), map[string]string{
		"name":        "Production EU",
		"description": "EU West production",
		"region":      "eu-west-1",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	updated := ReadJSONMap(t, resp)
	assert.Equal(t, "Production EU", updated["name"])
	assert.Equal(t, "eu-west-1", updated["region"])

	// --- Delete cluster ---
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- Verify deleted ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestClusterCIDRAutoAllocation verifies that each new cluster gets a unique CIDR.
func TestClusterCIDRAutoAllocation(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "cidr@example.com", "password123", "CIDR User")
	teamID := env.CreateTeamAsUser(env.Client, "cidr-test-team")

	// Create two clusters
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{
		"name": "Cluster A",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterA := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{
		"name": "Cluster B",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterB := ReadJSONMap(t, resp)

	// CIDRs should be different
	assert.NotEqual(t, clusterA["cidr"], clusterB["cidr"],
		"each cluster should get a unique CIDR")
}

// TestClusterMemberAddRemove verifies adding and removing servers from a cluster.
func TestClusterMemberAddRemove(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "member@example.com", "password123", "Member User")
	teamID := env.CreateTeamAsUser(env.Client, "member-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	// Create cluster
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{
		"name": "Test Cluster",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	// Create two servers
	srv1 := insertTestServerWithName(t, env, teamUUID, "server-1", "10.0.1.1")
	srv2 := insertTestServerWithName(t, env, teamUUID, "server-2", "10.0.1.2")

	// --- Add member ---
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv1.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, "add member should return 201")
	member1 := ReadJSONMap(t, resp)
	assert.NotEmpty(t, member1["wireguard_ip"])

	// --- Add second member ---
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv2.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	member2 := ReadJSONMap(t, resp)
	assert.NotEqual(t, member1["wireguard_ip"], member2["wireguard_ip"],
		"each member should get a unique WireGuard IP")

	// --- List members ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var members []map[string]any
	ReadJSON(t, resp, &members)
	assert.Len(t, members, 2)

	// --- Verify member count in cluster detail ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	detail := ReadJSONMap(t, resp)
	assert.Equal(t, float64(2), detail["member_count"])

	// --- Remove member ---
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members/%s", teamID, clusterID, srv1.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- Verify only 1 member left ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	ReadJSON(t, resp, &members)
	assert.Len(t, members, 1)
}

// TestClusterMemberDuplicateRejected verifies a server can't be added to two clusters.
func TestClusterMemberDuplicateRejected(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "dupe@example.com", "password123", "Dupe User")
	teamID := env.CreateTeamAsUser(env.Client, "dupe-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	// Create two clusters
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Cluster 1"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	c1 := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Cluster 2"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	c2 := ReadJSONMap(t, resp)

	// Create server
	srv := insertTestServerWithName(t, env, teamUUID, "shared-srv", "10.0.2.1")

	// Add to cluster 1 — should succeed
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, c1["id"]), map[string]string{
		"server_id": srv.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Add to cluster 2 — should fail (server already in a cluster)
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, c2["id"]), map[string]string{
		"server_id": srv.ID.String(),
	})
	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	resp.Body.Close()
}

// TestClusterNotFound verifies 404 for non-existent cluster.
func TestClusterNotFound(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "nocluster@example.com", "password123", "NoCluster User")
	teamID := env.CreateTeamAsUser(env.Client, "nocluster-test-team")

	fakeID := uuid.New().String()
	resp := env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, fakeID))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestClusterDeleteCascadesMembers verifies deleting a cluster removes its members.
func TestClusterDeleteCascadesMembers(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "casccluster@example.com", "password123", "CascCluster User")
	teamID := env.CreateTeamAsUser(env.Client, "casccluster-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Cascade Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	srv := insertTestServerWithName(t, env, teamUUID, "casc-srv", "10.0.3.1")

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Delete cluster
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Server should no longer be in any cluster
	_, err = env.Queries.GetClusterMemberByServerID(env.Ctx, srv.ID)
	assert.Error(t, err, "member record should be deleted when cluster is deleted")
}

// TestClusterMeshHealthEmpty verifies mesh health endpoint works with no peers.
func TestClusterMeshHealthEmpty(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "meshempty@example.com", "password123", "MeshEmpty User")
	teamID := env.CreateTeamAsUser(env.Client, "meshempty-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Empty Mesh"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/mesh", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var peers []map[string]any
	ReadJSON(t, resp, &peers)
	assert.Len(t, peers, 0)
}

// TestClusterEventsEmpty verifies events endpoint works with no events.
func TestClusterEventsEmpty(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "eventsempty@example.com", "password123", "EventsEmpty User")
	teamID := env.CreateTeamAsUser(env.Client, "eventsempty-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "No Events"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/events", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var events []map[string]any
	ReadJSON(t, resp, &events)
	assert.Len(t, events, 0)
}

// TestClusterCreateValidation verifies that cluster creation rejects invalid input.
func TestClusterCreateValidation(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "validate@example.com", "password123", "Validate User")
	teamID := env.CreateTeamAsUser(env.Client, "validate-test-team")

	// Missing name
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{
		"description": "no name",
	})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// insertTestServerWithName is defined in server_test.go.
