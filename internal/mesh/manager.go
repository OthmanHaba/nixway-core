package mesh

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/dns"
)

// AgentSender abstracts the ability to send control messages to agents.
type AgentSender interface {
	SendToAgent(agentID string, msg *agentv1.ControlMessage) error
}

// Manager orchestrates mesh regeneration and DNS updates across cluster members.
type Manager struct {
	queries *db.Queries
	sender  AgentSender
	redis   *redis.Client
	logger  *slog.Logger
}

// NewManager creates a new mesh manager.
func NewManager(queries *db.Queries, sender AgentSender, redisClient *redis.Client, logger *slog.Logger) *Manager {
	return &Manager{queries: queries, sender: sender, redis: redisClient, logger: logger}
}

// meshChannel returns the Redis pub/sub channel for mesh operations on a cluster.
func meshChannel(clusterID uuid.UUID) string {
	return "mesh:" + clusterID.String()
}

// publish sends a log line to Redis pub/sub and persists it as a mesh event.
func (m *Manager) publish(ctx context.Context, clusterID uuid.UUID, eventType, message string, memberID *uuid.UUID) {
	// Publish to Redis for SSE consumers
	if m.redis != nil {
		payload, _ := json.Marshal(map[string]string{
			"event":   eventType,
			"message": message,
		})
		m.redis.Publish(ctx, meshChannel(clusterID), string(payload))
	}

	// Persist as mesh event
	details, _ := json.Marshal(map[string]string{"message": message})
	var pgMemberID pgtype.UUID
	if memberID != nil {
		pgMemberID = pgtype.UUID{Bytes: *memberID, Valid: true}
	}
	_, _ = m.queries.CreateMeshEvent(ctx, db.CreateMeshEventParams{
		ClusterID: clusterID,
		EventType: eventType,
		MemberID:  pgMemberID,
		Details:   details,
	})

	m.logger.Info(message, "cluster_id", clusterID, "event", eventType)
}

// RegenerateMesh regenerates WireGuard configs for all members in a cluster
// and pushes them to the connected agents. Also updates DNS.
func (m *Manager) RegenerateMesh(ctx context.Context, clusterID uuid.UUID) error {
	m.publish(ctx, clusterID, "mesh_regenerating", "Starting mesh regeneration...", nil)

	members, err := m.queries.GetClusterMembersForMesh(ctx, clusterID)
	if err != nil {
		msg := fmt.Sprintf("Failed to get mesh members: %v", err)
		m.publish(ctx, clusterID, "error", msg, nil)
		return fmt.Errorf("get mesh members: %w", err)
	}

	if len(members) == 0 {
		m.publish(ctx, clusterID, "mesh_regenerated", "No members in cluster, nothing to do", nil)
		return nil
	}

	m.publish(ctx, clusterID, "info", fmt.Sprintf("Found %d members in cluster", len(members)), nil)

	// Build MemberInfo list
	var memberInfos []MemberInfo
	for _, r := range members {
		agentID := ""
		if r.AgentID != nil {
			agentID = *r.AgentID
		}
		memberInfos = append(memberInfos, MemberInfo{
			MemberID:    r.ID.String(),
			ServerName:  r.ServerName,
			AgentID:     agentID,
			WireGuardIP: r.WireguardIp.String(),
			PublicKey:   r.WireguardPublicKey,
			Endpoint:    r.WireguardEndpoint,
			ListenPort:  int(r.ListenPort),
		})
	}

	// Ensure peer records exist for full mesh
	m.ensurePeerRecords(ctx, clusterID, members)

	// Check if all members have public keys
	allHaveKeys := true
	for _, mi := range memberInfos {
		if mi.PublicKey == "" {
			allHaveKeys = false
			break
		}
	}

	// Generate and push config to each agent
	for _, self := range memberInfos {
		memberUUID, _ := uuid.Parse(self.MemberID)

		if self.AgentID == "" {
			m.publish(ctx, clusterID, "warning", fmt.Sprintf("Server %s has no agent connected, skipping", self.ServerName), &memberUUID)
			continue
		}

		// If no public key, send keygen command
		if self.PublicKey == "" {
			m.publish(ctx, clusterID, "keygen_requested", fmt.Sprintf("Requesting WireGuard keygen from %s...", self.ServerName), &memberUUID)
			m.sendKeyGenCommand(self.AgentID, self.MemberID, self.ListenPort)
			continue
		}

		// Only push full config if ALL members have keys (otherwise partial mesh)
		if !allHaveKeys {
			m.publish(ctx, clusterID, "info", fmt.Sprintf("Waiting for all members to complete keygen before pushing config to %s", self.ServerName), &memberUUID)
			continue
		}

		cfg, err := GenerateConfig(self, memberInfos)
		if err != nil {
			m.publish(ctx, clusterID, "error", fmt.Sprintf("Failed to generate config for %s: %v", self.ServerName, err), &memberUUID)
			continue
		}

		m.publish(ctx, clusterID, "config_pushed", fmt.Sprintf("Pushing WireGuard config to %s (IP: %s, %d peers)", self.ServerName, self.WireGuardIP, len(memberInfos)-1), &memberUUID)

		if err := m.sender.SendToAgent(self.AgentID, &agentv1.ControlMessage{
			Payload: &agentv1.ControlMessage_WireguardApply{
				WireguardApply: &agentv1.WireGuardApplyCommand{
					MemberId:    self.MemberID,
					Config:      cfg,
					WireguardIp: self.WireGuardIP,
				},
			},
		}); err != nil {
			m.publish(ctx, clusterID, "error", fmt.Sprintf("Failed to send config to %s: %v", self.ServerName, err), &memberUUID)
		}
	}

	if allHaveKeys {
		cluster, err := m.queries.GetClusterByIDAnyTeam(ctx, clusterID)
		if err != nil {
			m.publish(ctx, clusterID, "warning", fmt.Sprintf("Mesh configured but DNS update skipped: cluster lookup failed: %v", err), nil)
		} else {
			m.UpdateDNSForCluster(ctx, clusterID, cluster.Slug, memberInfos)
		}
		m.publish(ctx, clusterID, "mesh_regenerated", fmt.Sprintf("Mesh regeneration complete — %d nodes configured", len(memberInfos)), nil)
	} else {
		m.publish(ctx, clusterID, "info", "Waiting for keygen results before completing mesh setup...", nil)
	}

	return nil
}

// TeardownMember sends a WireGuard teardown command to a specific agent.
func (m *Manager) TeardownMember(ctx context.Context, clusterID uuid.UUID, agentID, memberID, serverName string) {
	if agentID == "" {
		return
	}
	memberUUID, _ := uuid.Parse(memberID)
	m.publish(ctx, clusterID, "teardown_sent", fmt.Sprintf("Sending WireGuard teardown to %s", serverName), &memberUUID)

	if err := m.sender.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_WireguardTeardown{
			WireguardTeardown: &agentv1.WireGuardTeardownCommand{
				MemberId: memberID,
			},
		},
	}); err != nil {
		m.publish(ctx, clusterID, "error", fmt.Sprintf("Failed to send teardown to %s: %v", serverName, err), &memberUUID)
	}
}

// RequestKeyGen sends a WireGuard key generation command to an agent.
func (m *Manager) RequestKeyGen(agentID, memberID string, listenPort int) {
	m.sendKeyGenCommand(agentID, memberID, listenPort)
}

// OnKeyGenResult is called when an agent reports its public key.
// It logs the event and triggers mesh regeneration.
func (m *Manager) OnKeyGenResult(ctx context.Context, clusterID uuid.UUID, memberID uuid.UUID, serverName, publicKey string) {
	m.publish(ctx, clusterID, "keygen_complete", fmt.Sprintf("WireGuard keygen complete for %s (pubkey: %s...)", serverName, publicKey[:8]), &memberID)

	// Trigger full mesh regeneration now that this member has a key
	if err := m.RegenerateMesh(ctx, clusterID); err != nil {
		m.publish(ctx, clusterID, "error", fmt.Sprintf("Mesh regeneration failed after keygen: %v", err), &memberID)
	}
}

// OnApplyResult logs when an agent confirms config was applied.
func (m *Manager) OnApplyResult(ctx context.Context, clusterID uuid.UUID, memberID uuid.UUID, serverName string, success bool, errMsg string) {
	if success {
		m.publish(ctx, clusterID, "config_applied", fmt.Sprintf("WireGuard interface up on %s", serverName), &memberID)
	} else {
		m.publish(ctx, clusterID, "error", fmt.Sprintf("WireGuard config apply failed on %s: %s", serverName, errMsg), &memberID)
	}
}

// OnTeardownResult logs when an agent confirms teardown.
func (m *Manager) OnTeardownResult(ctx context.Context, clusterID uuid.UUID, memberID uuid.UUID, serverName string, success bool) {
	if success {
		m.publish(ctx, clusterID, "teardown_complete", fmt.Sprintf("WireGuard torn down on %s", serverName), &memberID)
	} else {
		m.publish(ctx, clusterID, "warning", fmt.Sprintf("WireGuard teardown may have failed on %s", serverName), &memberID)
	}
}

func (m *Manager) sendKeyGenCommand(agentID, memberID string, listenPort int) {
	if err := m.sender.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_WireguardKeygen{
			WireguardKeygen: &agentv1.WireGuardKeyGenCommand{
				MemberId:   memberID,
				ListenPort: int32(listenPort),
			},
		},
	}); err != nil {
		m.logger.Warn("failed to send keygen command", "agent_id", agentID, "error", err)
	}
}

func (m *Manager) ensurePeerRecords(ctx context.Context, clusterID uuid.UUID, members []db.GetClusterMembersForMeshRow) {
	for _, from := range members {
		for _, to := range members {
			if from.ID == to.ID {
				continue
			}
			_ = m.queries.UpsertWireGuardPeer(ctx, db.UpsertWireGuardPeerParams{
				MemberID:     from.ID,
				PeerMemberID: to.ID,
				Status:       "pending",
			})
		}
	}
}

// UpdateDNSForCluster generates and pushes DNS config to all cluster members.
func (m *Manager) UpdateDNSForCluster(ctx context.Context, clusterID uuid.UUID, clusterSlug string, memberInfos []MemberInfo) {
	m.publish(ctx, clusterID, "dns_updating", "Pushing DNS config to cluster members...", nil)

	var dnsMembers []dns.MemberDNSInfo
	for _, mi := range memberInfos {
		dnsMembers = append(dnsMembers, dns.MemberDNSInfo{
			ServerName:  mi.ServerName,
			WireGuardIP: mi.WireGuardIP,
		})
	}

	records := dns.BuildRecords(clusterSlug, dnsMembers)
	hostsContent := dns.GenerateHostsFile(records)
	corefileContent := dns.GenerateCorefile(clusterSlug)

	for _, mi := range memberInfos {
		if mi.AgentID == "" {
			continue
		}
		if err := m.sender.SendToAgent(mi.AgentID, &agentv1.ControlMessage{
			Payload: &agentv1.ControlMessage_DnsUpdateHosts{
				DnsUpdateHosts: &agentv1.DNSUpdateHostsCommand{
					ClusterSlug:     clusterSlug,
					HostsContent:    hostsContent,
					CorefileContent: corefileContent,
					DeployCoredns:   true,
				},
			},
		}); err != nil {
			m.logger.Warn("failed to send DNS update", "agent_id", mi.AgentID, "error", err)
		}
	}

	m.publish(ctx, clusterID, "dns_updated", "DNS config pushed to all members", nil)
}
