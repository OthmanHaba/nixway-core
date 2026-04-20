package cluster

import (
	"context"
	"fmt"
	"log/slog"
	"net/netip"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/mesh"
)

// Service orchestrates cluster CRUD and member management.
type Service struct {
	queries   *db.Queries
	allocator *CIDRAllocator
	logger    *slog.Logger
}

// NewService creates a new cluster service.
func NewService(queries *db.Queries, poolCIDR string, logger *slog.Logger) *Service {
	return &Service{
		queries:   queries,
		allocator: NewCIDRAllocator(poolCIDR),
		logger:    logger,
	}
}

// CreateClusterRequest holds the parameters for creating a cluster.
type CreateClusterRequest struct {
	TeamID      uuid.UUID
	Name        string
	Description string
	Region      string
}

// CreateCluster creates a new cluster with an auto-allocated CIDR.
func (s *Service) CreateCluster(ctx context.Context, req CreateClusterRequest) (db.Cluster, error) {
	slug := GenerateSlug(req.Name)

	// Get used CIDRs from DB
	usedRows, err := s.queries.ListAllClusterCIDRs(ctx)
	if err != nil {
		return db.Cluster{}, fmt.Errorf("list used CIDRs: %w", err)
	}
	var usedCIDRs []string
	for _, row := range usedRows {
		usedCIDRs = append(usedCIDRs, row.String())
	}

	cidr, err := s.allocator.AllocateClusterCIDR(usedCIDRs)
	if err != nil {
		return db.Cluster{}, fmt.Errorf("allocate CIDR: %w", err)
	}

	cidrPrefix, err := netip.ParsePrefix(cidr.String())
	if err != nil {
		return db.Cluster{}, fmt.Errorf("parse CIDR prefix: %w", err)
	}

	cluster, err := s.queries.CreateCluster(ctx, db.CreateClusterParams{
		TeamID:      req.TeamID,
		Name:        req.Name,
		Slug:        slug,
		Description: req.Description,
		Region:      req.Region,
		Cidr:        cidrPrefix,
	})
	if err != nil {
		return db.Cluster{}, fmt.Errorf("create cluster: %w", err)
	}

	s.logger.Info("cluster created",
		"cluster_id", cluster.ID,
		"name", cluster.Name,
		"cidr", cluster.Cidr,
	)

	return cluster, nil
}

// AddMemberRequest holds the parameters for adding a server to a cluster.
type AddMemberRequest struct {
	ClusterID uuid.UUID
	ServerID  uuid.UUID
	TeamID    uuid.UUID
}

// AddMember adds a server to a cluster, allocating a WireGuard IP.
// Returns the new member record. The caller is responsible for triggering mesh regeneration.
func (s *Service) AddMember(ctx context.Context, req AddMemberRequest) (db.ClusterMember, error) {
	// Verify the cluster exists and belongs to the team
	cluster, err := s.queries.GetClusterByID(ctx, db.GetClusterByIDParams{
		ID:     req.ClusterID,
		TeamID: req.TeamID,
	})
	if err != nil {
		return db.ClusterMember{}, fmt.Errorf("get cluster: %w", err)
	}

	// Verify the server exists and belongs to the team
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{
		ID:     req.ServerID,
		TeamID: req.TeamID,
	})
	if err != nil {
		return db.ClusterMember{}, fmt.Errorf("get server: %w", err)
	}

	// Check server isn't already in a cluster
	_, err = s.queries.GetClusterMemberByServerID(ctx, req.ServerID)
	if err == nil {
		return db.ClusterMember{}, fmt.Errorf("server %s is already in a cluster", req.ServerID)
	}

	// Allocate WireGuard IP
	usedIPRows, err := s.queries.ListClusterMemberIPs(ctx, req.ClusterID)
	if err != nil {
		return db.ClusterMember{}, fmt.Errorf("list member IPs: %w", err)
	}
	var usedIPs []string
	for _, row := range usedIPRows {
		usedIPs = append(usedIPs, row.String())
	}

	wgIP, err := s.allocator.AllocateServerIP(cluster.Cidr.String(), usedIPs)
	if err != nil {
		return db.ClusterMember{}, fmt.Errorf("allocate WireGuard IP: %w", err)
	}

	// Endpoint is the server's public IP + WireGuard listen port
	endpoint := fmt.Sprintf("%s:51820", srv.PublicIp.String())

	wgIPAddr, err := netip.ParseAddr(wgIP.String())
	if err != nil {
		return db.ClusterMember{}, fmt.Errorf("parse WireGuard IP: %w", err)
	}

	member, err := s.queries.CreateClusterMember(ctx, db.CreateClusterMemberParams{
		ClusterID:          req.ClusterID,
		ServerID:           req.ServerID,
		WireguardIp:        wgIPAddr,
		WireguardPublicKey: "", // will be set after agent generates key
		WireguardEndpoint:  endpoint,
		ListenPort:         51820,
	})
	if err != nil {
		return db.ClusterMember{}, fmt.Errorf("create member: %w", err)
	}

	// Update the server's cluster_id for convenience lookups
	_ = s.queries.UpdateServerClusterID(ctx, db.UpdateServerClusterIDParams{
		ID:        req.ServerID,
		ClusterID: pgtype.UUID{Bytes: req.ClusterID, Valid: true},
	})

	s.logger.Info("member added to cluster",
		"cluster_id", req.ClusterID,
		"server_id", req.ServerID,
		"wireguard_ip", wgIP.String(),
	)

	return member, nil
}

// RemoveMember removes a server from a cluster.
// The caller is responsible for triggering mesh regeneration and WireGuard teardown.
func (s *Service) RemoveMember(ctx context.Context, clusterID, serverID uuid.UUID) error {
	// Delete peer records for this member
	member, err := s.queries.GetClusterMemberByServerID(ctx, serverID)
	if err != nil {
		return fmt.Errorf("get member: %w", err)
	}

	if err := s.queries.DeletePeersByMember(ctx, member.ID); err != nil {
		s.logger.Warn("failed to delete peer records", "member_id", member.ID, "error", err)
	}

	if err := s.queries.DeleteClusterMember(ctx, db.DeleteClusterMemberParams{
		ClusterID: clusterID,
		ServerID:  serverID,
	}); err != nil {
		return fmt.Errorf("delete member: %w", err)
	}

	// Clear server's cluster_id
	_ = s.queries.ClearServerClusterID(ctx, serverID)

	s.logger.Info("member removed from cluster",
		"cluster_id", clusterID,
		"server_id", serverID,
	)

	return nil
}

// GetMeshMembers returns MemberInfo for all members in a cluster, used for WireGuard config generation.
func (s *Service) GetMeshMembers(ctx context.Context, clusterID uuid.UUID) ([]mesh.MemberInfo, error) {
	rows, err := s.queries.GetClusterMembersForMesh(ctx, clusterID)
	if err != nil {
		return nil, fmt.Errorf("get mesh members: %w", err)
	}

	var members []mesh.MemberInfo
	for _, r := range rows {
		agentID := ""
		if r.AgentID != nil {
			agentID = *r.AgentID
		}
		members = append(members, mesh.MemberInfo{
			MemberID:    r.ID.String(),
			ServerName:  r.ServerName,
			AgentID:     agentID,
			WireGuardIP: r.WireguardIp.String(),
			PublicKey:   r.WireguardPublicKey,
			Endpoint:    r.WireguardEndpoint,
			ListenPort:  int(r.ListenPort),
		})
	}

	return members, nil
}
