package integration

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestClusterThreeMembersUniqueIPs verifies that 3 servers get unique WireGuard IPs.
func TestClusterThreeMembersUniqueIPs(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "threeip@example.com", "password123", "ThreeIP User")
	teamID := env.CreateTeamAsUser(env.Client, "threeip-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Three Node Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	srv1 := insertTestServerWithName(t, env, teamUUID, "node-1", "10.0.10.1")
	srv2 := insertTestServerWithName(t, env, teamUUID, "node-2", "10.0.10.2")
	srv3 := insertTestServerWithName(t, env, teamUUID, "node-3", "10.0.10.3")

	ips := make(map[string]bool)
	for _, srv := range []db.Server{srv1, srv2, srv3} {
		resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
			"server_id": srv.ID.String(),
		})
		require.Equal(t, http.StatusCreated, resp.StatusCode)
		member := ReadJSONMap(t, resp)
		ip := member["wireguard_ip"].(string)
		assert.NotEmpty(t, ip)
		assert.False(t, ips[ip], "duplicate WireGuard IP: %s", ip)
		ips[ip] = true
	}

	assert.Len(t, ips, 3, "should have 3 unique WireGuard IPs")

	// Verify member count
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	detail := ReadJSONMap(t, resp)
	assert.Equal(t, float64(3), detail["member_count"])
}

// TestClusterMemberReAddAfterRemoval verifies a server can rejoin after removal.
func TestClusterMemberReAddAfterRemoval(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "readd@example.com", "password123", "ReAdd User")
	teamID := env.CreateTeamAsUser(env.Client, "readd-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "ReAdd Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	srv := insertTestServerWithName(t, env, teamUUID, "flip-srv", "10.0.11.1")

	// Add
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Remove
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members/%s", teamID, clusterID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Re-add — should succeed
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode, "server should be re-addable after removal")
	member := ReadJSONMap(t, resp)
	assert.NotEmpty(t, member["wireguard_ip"])
}

// TestServerDeleteCleansClusterMembership verifies deleting a server removes its cluster membership.
func TestServerDeleteCleansClusterMembership(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "srvdelcluster@example.com", "password123", "SrvDelCluster User")
	teamID := env.CreateTeamAsUser(env.Client, "srvdelcluster-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "SrvDel Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	srv := insertTestServerWithName(t, env, teamUUID, "doomed-srv", "10.0.12.1")

	// Add to cluster
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Delete the server itself
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/servers/%s", teamID, srv.ID.String()))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Cluster member should be gone (CASCADE)
	_, err = env.Queries.GetClusterMemberByServerID(env.Ctx, srv.ID)
	assert.Error(t, err, "cluster membership should be deleted when server is deleted")

	// Cluster should have 0 members
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	detail := ReadJSONMap(t, resp)
	assert.Equal(t, float64(0), detail["member_count"])
}

// TestClusterPeerRecordsCreated verifies that peer records are created in the DB
// when members are added to a cluster and mesh health is queried.
func TestClusterPeerRecordsCreated(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "peerrec@example.com", "password123", "PeerRec User")
	teamID := env.CreateTeamAsUser(env.Client, "peerrec-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Peer Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)
	clusterUUID, _ := uuid.Parse(clusterID)

	srv1 := insertTestServerWithName(t, env, teamUUID, "peer-srv-1", "10.0.13.1")
	srv2 := insertTestServerWithName(t, env, teamUUID, "peer-srv-2", "10.0.13.2")

	// Add both members
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv1.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	m1 := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv2.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	m2 := ReadJSONMap(t, resp)

	// Manually create peer records (normally done by mesh manager during RegenerateMesh)
	m1ID, _ := uuid.Parse(m1["id"].(string))
	m2ID, _ := uuid.Parse(m2["id"].(string))
	_ = env.Queries.UpsertWireGuardPeer(env.Ctx, db.UpsertWireGuardPeerParams{
		MemberID: m1ID, PeerMemberID: m2ID, Status: "active",
	})
	_ = env.Queries.UpsertWireGuardPeer(env.Ctx, db.UpsertWireGuardPeerParams{
		MemberID: m2ID, PeerMemberID: m1ID, Status: "active",
	})

	// Query mesh health endpoint
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/mesh", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var peers []map[string]any
	ReadJSON(t, resp, &peers)
	assert.Len(t, peers, 2, "should have 2 directional peer records for 2 members")

	// Verify peer records have expected fields
	for _, peer := range peers {
		assert.Contains(t, peer, "member_id")
		assert.Contains(t, peer, "peer_member_id")
		assert.Contains(t, peer, "status")
		assert.Equal(t, "active", peer["status"])
	}

	// Verify count query
	count, err := env.Queries.CountTotalPeersByCluster(env.Ctx, clusterUUID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)

	failedCount, err := env.Queries.CountFailedPeersByCluster(env.Ctx, clusterUUID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), failedCount)
}

// TestClusterPeerHealthUpdate verifies that peer health can be updated and read back.
func TestClusterPeerHealthUpdate(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "peerhealth@example.com", "password123", "PeerHealth User")
	teamID := env.CreateTeamAsUser(env.Client, "peerhealth-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Health Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	srv1 := insertTestServerWithName(t, env, teamUUID, "health-1", "10.0.14.1")
	srv2 := insertTestServerWithName(t, env, teamUUID, "health-2", "10.0.14.2")

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv1.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	m1 := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv2.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	m2 := ReadJSONMap(t, resp)

	m1ID, _ := uuid.Parse(m1["id"].(string))
	m2ID, _ := uuid.Parse(m2["id"].(string))

	// Create initial peer records
	_ = env.Queries.UpsertWireGuardPeer(env.Ctx, db.UpsertWireGuardPeerParams{
		MemberID: m1ID, PeerMemberID: m2ID, Status: "pending",
	})

	// Update peer health with RTT and handshake
	rttMs := int32(15)
	handshake := pgtype.Timestamptz{Time: time.Now().Add(-10 * time.Second), Valid: true}
	err = env.Queries.UpdatePeerHealth(env.Ctx, db.UpdatePeerHealthParams{
		MemberID:        m1ID,
		PeerMemberID:    m2ID,
		Status:          "active",
		LastHandshakeAt: handshake,
		RttMs:           &rttMs,
	})
	require.NoError(t, err)

	// Read back
	status, err := env.Queries.GetPeerStatus(env.Ctx, db.GetPeerStatusParams{
		MemberID: m1ID, PeerMemberID: m2ID,
	})
	require.NoError(t, err)
	assert.Equal(t, "active", status)
}

// TestClusterMeshEventsRecorded verifies mesh events are persisted and queryable.
func TestClusterMeshEventsRecorded(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "meshevt@example.com", "password123", "MeshEvt User")
	teamID := env.CreateTeamAsUser(env.Client, "meshevt-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Events Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)
	clusterUUID, _ := uuid.Parse(clusterID)

	// Insert mesh events directly
	_, err := env.Queries.CreateMeshEvent(env.Ctx, db.CreateMeshEventParams{
		ClusterID: clusterUUID,
		EventType: "mesh_regenerating",
		Details:   []byte(`{"message":"Starting mesh regeneration..."}`),
	})
	require.NoError(t, err)

	_, err = env.Queries.CreateMeshEvent(env.Ctx, db.CreateMeshEventParams{
		ClusterID: clusterUUID,
		EventType: "mesh_regenerated",
		Details:   []byte(`{"message":"Mesh regeneration complete"}`),
	})
	require.NoError(t, err)

	// Query via API
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/events", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var events []map[string]any
	ReadJSON(t, resp, &events)
	require.Len(t, events, 2)

	// Events should be newest first
	assert.Equal(t, "mesh_regenerated", events[0]["event_type"])
	assert.Equal(t, "mesh_regenerating", events[1]["event_type"])
}

// TestClusterAuditLogging verifies cluster create and delete produce audit entries.
func TestClusterAuditLogging(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "clustaudit@example.com", "password123", "ClustAudit User")
	teamID := env.CreateTeamAsUser(env.Client, "clustaudit-test-team")

	// Create cluster
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Audit Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	// Delete cluster
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
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
	assert.True(t, actions["cluster.create"], "audit log should contain cluster.create")
	assert.True(t, actions["cluster.delete"], "audit log should contain cluster.delete")
}

// TestClusterAddMemberAuditLogging verifies member add/remove produce audit entries.
func TestClusterAddMemberAuditLogging(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "memaudit@example.com", "password123", "MemAudit User")
	teamID := env.CreateTeamAsUser(env.Client, "memaudit-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "MemAudit Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	srv := insertTestServerWithName(t, env, teamUUID, "audit-srv", "10.0.15.1")

	// Add member
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Remove member
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members/%s", teamID, clusterID, srv.ID.String()))
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
	assert.True(t, actions["cluster.add_member"], "audit log should contain cluster.add_member")
	assert.True(t, actions["cluster.remove_member"], "audit log should contain cluster.remove_member")
}

// TestClusterUpdateSlugUnchanged verifies that updating a cluster name doesn't change the slug.
func TestClusterUpdateSlugUnchanged(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "slugupd@example.com", "password123", "SlugUpd User")
	teamID := env.CreateTeamAsUser(env.Client, "slugupd-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Original Name"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	original := ReadJSONMap(t, resp)
	clusterID := original["id"].(string)
	originalSlug := original["slug"].(string)

	// Update name
	resp = env.Put(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID), map[string]string{
		"name": "Updated Name",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	updated := ReadJSONMap(t, resp)

	assert.Equal(t, "Updated Name", updated["name"])
	assert.Equal(t, originalSlug, updated["slug"], "slug should not change on update")
}

// TestClusterRegenerateMeshEndpoint verifies the regenerate mesh endpoint returns 200.
func TestClusterRegenerateMeshEndpoint(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "regen@example.com", "password123", "Regen User")
	teamID := env.CreateTeamAsUser(env.Client, "regen-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "Regen Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/mesh/regenerate", teamID, clusterID), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	result := ReadJSONMap(t, resp)
	assert.Equal(t, "regeneration_started", result["status"])
}

// TestClusterAddMemberMissingServerID verifies validation on add member.
func TestClusterAddMemberMissingServerID(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "nosvrid@example.com", "password123", "NoSvrID User")
	teamID := env.CreateTeamAsUser(env.Client, "nosvrid-test-team")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "NoSvrID Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)

	// Missing server_id
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// TestClusterDeleteRemovesPeerRecords verifies cascade cleanup of peer records.
func TestClusterDeleteRemovesPeerRecords(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "delpeers@example.com", "password123", "DelPeers User")
	teamID := env.CreateTeamAsUser(env.Client, "delpeers-test-team")
	teamUUID, err := uuid.Parse(teamID)
	require.NoError(t, err)

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID), map[string]string{"name": "DelPeers Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	clusterData := ReadJSONMap(t, resp)
	clusterID := clusterData["id"].(string)
	clusterUUID, _ := uuid.Parse(clusterID)

	srv1 := insertTestServerWithName(t, env, teamUUID, "del-peer-1", "10.0.16.1")
	srv2 := insertTestServerWithName(t, env, teamUUID, "del-peer-2", "10.0.16.2")

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv1.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	m1 := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters/%s/members", teamID, clusterID), map[string]string{
		"server_id": srv2.ID.String(),
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	m2 := ReadJSONMap(t, resp)

	// Create peer records
	m1ID, _ := uuid.Parse(m1["id"].(string))
	m2ID, _ := uuid.Parse(m2["id"].(string))
	_ = env.Queries.UpsertWireGuardPeer(env.Ctx, db.UpsertWireGuardPeerParams{
		MemberID: m1ID, PeerMemberID: m2ID, Status: "active",
	})
	_ = env.Queries.UpsertWireGuardPeer(env.Ctx, db.UpsertWireGuardPeerParams{
		MemberID: m2ID, PeerMemberID: m1ID, Status: "active",
	})

	// Delete cluster
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/clusters/%s", teamID, clusterID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Peer records should be gone (CASCADE via cluster -> members -> peers)
	count, err := env.Queries.CountTotalPeersByCluster(env.Ctx, clusterUUID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

// TestClusterCIDRConsistentAcrossTeams verifies CIDRs are unique globally, not per-team.
func TestClusterCIDRConsistentAcrossTeams(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "cidrglob@example.com", "password123", "CIDRGlob User")
	teamID1 := env.CreateTeamAsUser(env.Client, "cidrglob-team-1")
	teamID2 := env.CreateTeamAsUser(env.Client, "cidrglob-team-2")

	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID1), map[string]string{"name": "Team1 Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	c1 := ReadJSONMap(t, resp)

	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/clusters", teamID2), map[string]string{"name": "Team2 Cluster"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	c2 := ReadJSONMap(t, resp)

	assert.NotEqual(t, c1["cidr"], c2["cidr"], "CIDRs should be unique globally across teams")
}
