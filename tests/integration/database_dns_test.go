package integration

import (
	"context"
	"net/netip"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/othmanhaba/nixway-core/internal/db"
)

// TestDatabaseDNSCrossClusterIsolation verifies that databases in cluster A
// do NOT appear in cluster B's DNS hosts (and vice versa). This is the
// "cross-cluster denial" guarantee from Phase 8.4.
//
// We can't drive the full Provision flow without a live agent (it dispatches
// DeployCommand and waits on health), so we set up the same database row +
// cluster_member rows that Provision would have created, then call
// HostsForCluster directly. That exercises the exact same code path the mesh
// manager uses on every DNS push.
func TestDatabaseDNSCrossClusterIsolation(t *testing.T) {
	env := SetupTestEnv(t)
	ctx := env.Ctx
	q := env.Queries

	env.SignupAndLogin(env.Client, "dns-iso@example.com", "password123", "DNS Iso")
	teamIDStr := env.CreateTeamAsUser(env.Client, "dns-iso-team")
	teamID := uuid.MustParse(teamIDStr)

	// --- Two clusters, distinct CIDRs so wg IPs are distinct ---
	clusterA, err := q.CreateCluster(ctx, db.CreateClusterParams{
		TeamID: teamID, Name: "DNS Iso A", Slug: "dns-iso-a",
		Region: "test", Cidr: netip.MustParsePrefix("10.200.0.0/24"),
	})
	require.NoError(t, err)
	clusterB, err := q.CreateCluster(ctx, db.CreateClusterParams{
		TeamID: teamID, Name: "DNS Iso B", Slug: "dns-iso-b",
		Region: "test", Cidr: netip.MustParsePrefix("10.201.0.0/24"),
	})
	require.NoError(t, err)

	// --- One server per cluster, joined as a cluster_member with a wg IP ---
	srvA := mustCreateServer(t, ctx, q, teamID, "node-a", "node-a.local", "10.0.0.1")
	srvB := mustCreateServer(t, ctx, q, teamID, "node-b", "node-b.local", "10.0.0.2")

	wgA := netip.MustParseAddr("10.200.0.1")
	wgB := netip.MustParseAddr("10.201.0.1")
	_, err = q.CreateClusterMember(ctx, db.CreateClusterMemberParams{
		ClusterID: clusterA.ID, ServerID: srvA.ID,
		WireguardIp: wgA, WireguardPublicKey: "fake-key-a",
		WireguardEndpoint: "1.2.3.4:51820", ListenPort: 51820,
	})
	require.NoError(t, err)
	_, err = q.CreateClusterMember(ctx, db.CreateClusterMemberParams{
		ClusterID: clusterB.ID, ServerID: srvB.ID,
		WireguardIp: wgB, WireguardPublicKey: "fake-key-b",
		WireguardEndpoint: "5.6.7.8:51820", ListenPort: 51820,
	})
	require.NoError(t, err)

	// --- One project per cluster; database lives only in cluster A ---
	projA, err := q.CreateProject(ctx, db.CreateProjectParams{
		TeamID: teamID, ClusterID: clusterA.ID, Name: "Proj A", Slug: "proj-a",
	})
	require.NoError(t, err)
	_, err = q.CreateProject(ctx, db.CreateProjectParams{
		TeamID: teamID, ClusterID: clusterB.ID, Name: "Proj B", Slug: "proj-b",
	})
	require.NoError(t, err)

	dnsRecord := "pg-main.proj-a.cluster.internal"
	dbRow, err := q.CreateDatabase(ctx, db.CreateDatabaseParams{
		TeamID:                teamID,
		ProjectID:             projA.ID,
		ClusterID:             clusterA.ID,
		ServerID:              srvA.ID,
		VolumeID:              pgtype.UUID{Valid: false},
		TemplateSlug:          "postgresql",
		Version:               "16",
		Name:                  "pg-main",
		ContainerName:         "nw-db-proj-a-pg-main",
		Status:                "running",
		Port:                  5432,
		SuperuserSecretID:     pgtype.UUID{Valid: false},
		AppuserSecretID:       pgtype.UUID{Valid: false},
		ResourceCpuMillicores: 500,
		ResourceMemoryMb:      512,
	})
	require.NoError(t, err)
	require.NoError(t, q.UpdateDatabaseDNSRecord(ctx, db.UpdateDatabaseDNSRecordParams{
		ID:        dbRow.ID,
		DnsRecord: &dnsRecord,
	}))

	// --- Cluster A: DB record present ---
	recsA, err := env.DatabaseSvc.HostsForCluster(ctx, clusterA.ID)
	require.NoError(t, err)
	require.Len(t, recsA, 1, "cluster A should see the DB it owns")
	assert.Equal(t, dnsRecord, recsA[0].Hostname)
	assert.Equal(t, wgA.String(), recsA[0].IP)

	// --- Cluster B: NO DB records (cross-cluster denial) ---
	recsB, err := env.DatabaseSvc.HostsForCluster(ctx, clusterB.ID)
	require.NoError(t, err)
	assert.Empty(t, recsB, "cluster B must not see databases from cluster A")
}

// TestDatabaseDNSExcludesDeletedAndPending verifies that deleted DBs and DBs
// without a dns_record are filtered out of the hosts file.
func TestDatabaseDNSExcludesDeletedAndPending(t *testing.T) {
	env := SetupTestEnv(t)
	ctx := env.Ctx
	q := env.Queries

	env.SignupAndLogin(env.Client, "dns-filter@example.com", "password123", "DNS Filter")
	teamIDStr := env.CreateTeamAsUser(env.Client, "dns-filter-team")
	teamID := uuid.MustParse(teamIDStr)

	cluster, err := q.CreateCluster(ctx, db.CreateClusterParams{
		TeamID: teamID, Name: "Filter", Slug: "filter",
		Region: "test", Cidr: netip.MustParsePrefix("10.210.0.0/24"),
	})
	require.NoError(t, err)

	srv := mustCreateServer(t, ctx, q, teamID, "filter-node", "filter.local", "10.0.0.10")
	wg := netip.MustParseAddr("10.210.0.1")
	_, err = q.CreateClusterMember(ctx, db.CreateClusterMemberParams{
		ClusterID: cluster.ID, ServerID: srv.ID,
		WireguardIp: wg, WireguardPublicKey: "k",
		WireguardEndpoint: "1.2.3.4:51820", ListenPort: 51820,
	})
	require.NoError(t, err)

	proj, err := q.CreateProject(ctx, db.CreateProjectParams{
		TeamID: teamID, ClusterID: cluster.ID, Name: "P", Slug: "p",
	})
	require.NoError(t, err)

	makeDB := func(name, status string, withDNS bool) {
		row, err := q.CreateDatabase(ctx, db.CreateDatabaseParams{
			TeamID: teamID, ProjectID: proj.ID, ClusterID: cluster.ID,
			ServerID: srv.ID, VolumeID: pgtype.UUID{Valid: false},
			TemplateSlug: "postgresql", Version: "16",
			Name: name, ContainerName: "nw-db-p-" + name,
			Status: status, Port: 5432,
			SuperuserSecretID:     pgtype.UUID{Valid: false},
			AppuserSecretID:       pgtype.UUID{Valid: false},
			ResourceCpuMillicores: 500, ResourceMemoryMb: 512,
		})
		require.NoError(t, err)
		if withDNS {
			rec := name + ".p.cluster.internal"
			require.NoError(t, q.UpdateDatabaseDNSRecord(ctx, db.UpdateDatabaseDNSRecordParams{
				ID: row.ID, DnsRecord: &rec,
			}))
		}
	}
	makeDB("alive", "running", true)
	makeDB("pending", "provisioning", false)
	makeDB("gone", "deleted", true)

	recs, err := env.DatabaseSvc.HostsForCluster(ctx, cluster.ID)
	require.NoError(t, err)
	require.Len(t, recs, 1, "only the running DB with a dns_record should be included")
	assert.Equal(t, "alive.p.cluster.internal", recs[0].Hostname)
}

// mustCreateServer is a test helper that inserts a server row.
func mustCreateServer(t *testing.T, ctx context.Context, q *db.Queries, teamID uuid.UUID, name, hostname, ip string) db.Server {
	t.Helper()
	srv, err := q.CreateServer(ctx, db.CreateServerParams{
		TeamID:   teamID,
		Name:     name,
		Hostname: hostname,
		PublicIp: netip.MustParseAddr(ip),
		SshPort:  22,
		SshUser:  "root",
		Status:   "active",
	})
	require.NoError(t, err)
	return srv
}
