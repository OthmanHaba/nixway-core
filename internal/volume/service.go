package volume

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// Volume status state machine values.
const (
	StatusUnattached   = "unattached"
	StatusAttached     = "attached"
	StatusAttaching    = "attaching"
	StatusDetaching    = "detaching"
	StatusMoving       = "moving"
	StatusSnapshotting = "snapshotting"
	StatusResizing     = "resizing"
	StatusError        = "error"
)

// HostPathRoot is the on-disk root for all volume bind mounts on every server.
const HostPathRoot = "/var/lib/nixway/volumes"

// SnapshotPathRoot is the on-disk root for snapshot tarballs.
const SnapshotPathRoot = "/var/lib/nixway/snapshots"

// agentResultTimeout caps how long the service waits for an agent reply.
const agentResultTimeout = 5 * time.Minute

// Service orchestrates volume CRUD and lifecycle operations.
type Service struct {
	queries *db.Queries
	connMgr *agent.ConnManager
	logger  *slog.Logger

	mu      sync.Mutex
	pending map[string]chan *agentv1.VolumeResult
}

// NewService constructs a volume service.
func NewService(queries *db.Queries, connMgr *agent.ConnManager, logger *slog.Logger) *Service {
	return &Service{
		queries: queries,
		connMgr: connMgr,
		logger:  logger,
		pending: make(map[string]chan *agentv1.VolumeResult),
	}
}

// CreateRequest holds parameters for creating a volume.
type CreateRequest struct {
	TeamID     uuid.UUID
	ClusterID  uuid.UUID
	ServerID   uuid.UUID
	Name       string
	SizeGB     int32
	Filesystem string
}

// Create provisions a new volume on the target server.
func (s *Service) Create(ctx context.Context, req CreateRequest) (db.Volume, error) {
	if req.Name == "" {
		return db.Volume{}, errors.New("name is required")
	}
	if req.SizeGB <= 0 {
		return db.Volume{}, errors.New("size_gb must be greater than zero")
	}
	if req.Filesystem == "" {
		req.Filesystem = "ext4"
	}

	// Insert with a temporary host_path; we update once the row's UUID is known.
	created, err := s.queries.CreateVolume(ctx, db.CreateVolumeParams{
		TeamID:     req.TeamID,
		ClusterID:  req.ClusterID,
		ServerID:   req.ServerID,
		Name:       req.Name,
		SizeGb:     req.SizeGB,
		Filesystem: req.Filesystem,
		Status:     StatusUnattached,
		HostPath:   "/", // placeholder; rewritten immediately
	})
	if err != nil {
		return db.Volume{}, fmt.Errorf("create volume: %w", err)
	}

	hostPath := volumeHostPath(created.ID)
	if err := s.queries.UpdateVolumeHostPath(ctx, db.UpdateVolumeHostPathParams{
		ID:       created.ID,
		HostPath: hostPath,
	}); err != nil {
		return db.Volume{}, fmt.Errorf("persist host_path: %w", err)
	}

	requestID := uuid.NewString()
	cmd := &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_VolumeCreate{
			VolumeCreate: &agentv1.VolumeCreateCommand{
				RequestId: requestID,
				VolumeId:  created.ID.String(),
				HostPath:  hostPath,
				SizeGb:    req.SizeGB,
			},
		},
	}

	if _, err := s.dispatch(ctx, req.TeamID, req.ServerID, requestID, cmd); err != nil {
		_, _ = s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
			ID: created.ID, TeamID: req.TeamID, Status: StatusError,
		})
		s.logger.Warn("volume create dispatch failed", "volume_id", created.ID, "error", err)
	}

	final, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: created.ID, TeamID: req.TeamID})
	if err != nil {
		return db.Volume{}, fmt.Errorf("reload volume: %w", err)
	}
	return final, nil
}

// Get fetches a single volume.
func (s *Service) Get(ctx context.Context, teamID, id uuid.UUID) (db.Volume, error) {
	return s.queries.GetVolume(ctx, db.GetVolumeParams{ID: id, TeamID: teamID})
}

// ListFilter narrows the volume list query.
type ListFilter struct {
	ClusterID uuid.UUID
	ServerID  uuid.UUID
	Status    string
}

// List returns volumes for a team, optionally filtered by cluster, server, or status.
func (s *Service) List(ctx context.Context, teamID uuid.UUID, filter ListFilter) ([]db.Volume, error) {
	switch {
	case filter.ClusterID != uuid.Nil:
		return s.queries.ListVolumesByCluster(ctx, db.ListVolumesByClusterParams{TeamID: teamID, ClusterID: filter.ClusterID})
	case filter.ServerID != uuid.Nil:
		return s.queries.ListVolumesByServer(ctx, db.ListVolumesByServerParams{TeamID: teamID, ServerID: filter.ServerID})
	case filter.Status != "":
		return s.queries.ListVolumesByStatus(ctx, db.ListVolumesByStatusParams{TeamID: teamID, Status: filter.Status})
	default:
		return s.queries.ListVolumesByTeam(ctx, teamID)
	}
}

// Delete removes a volume after confirming and tells the agent to wipe the directory.
func (s *Service) Delete(ctx context.Context, teamID, id uuid.UUID) error {
	vol, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: id, TeamID: teamID})
	if err != nil {
		return fmt.Errorf("get volume: %w", err)
	}
	if vol.Status == StatusAttached {
		return fmt.Errorf("cannot delete attached volume; detach first")
	}

	requestID := uuid.NewString()
	cmd := &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_VolumeDelete{
			VolumeDelete: &agentv1.VolumeDeleteCommand{
				RequestId: requestID,
				VolumeId:  vol.ID.String(),
				HostPath:  vol.HostPath,
			},
		},
	}
	if _, err := s.dispatch(ctx, teamID, vol.ServerID, requestID, cmd); err != nil {
		s.logger.Warn("volume delete dispatch failed; removing record anyway", "volume_id", vol.ID, "error", err)
	}

	return s.queries.DeleteVolume(ctx, db.DeleteVolumeParams{ID: id, TeamID: teamID})
}

// AttachRequest holds attach parameters.
type AttachRequest struct {
	TeamID        uuid.UUID
	VolumeID      uuid.UUID
	ContainerName string
	MountPath     string
}

// Attach marks the volume attached and records the mount target. The actual
// container restart is handled by the deploy service in a later phase; here we
// only manage volume state.
func (s *Service) Attach(ctx context.Context, req AttachRequest) (db.Volume, error) {
	vol, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: req.VolumeID, TeamID: req.TeamID})
	if err != nil {
		return db.Volume{}, fmt.Errorf("get volume: %w", err)
	}
	if vol.Status != StatusUnattached {
		return db.Volume{}, fmt.Errorf("cannot attach volume in status %q", vol.Status)
	}
	if req.ContainerName == "" || req.MountPath == "" {
		return db.Volume{}, errors.New("container_name and mount_path are required")
	}
	mp := req.MountPath
	cn := req.ContainerName
	updated, err := s.queries.UpdateVolumeAttachment(ctx, db.UpdateVolumeAttachmentParams{
		ID:            req.VolumeID,
		TeamID:        req.TeamID,
		Status:        StatusAttached,
		MountPath:     &mp,
		ContainerName: &cn,
	})
	if err != nil {
		return db.Volume{}, fmt.Errorf("update attachment: %w", err)
	}
	return updated, nil
}

// Detach unmounts a volume from its container.
func (s *Service) Detach(ctx context.Context, teamID, id uuid.UUID) (db.Volume, error) {
	vol, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: id, TeamID: teamID})
	if err != nil {
		return db.Volume{}, fmt.Errorf("get volume: %w", err)
	}
	if vol.Status != StatusAttached {
		return db.Volume{}, fmt.Errorf("cannot detach volume in status %q", vol.Status)
	}
	updated, err := s.queries.UpdateVolumeAttachment(ctx, db.UpdateVolumeAttachmentParams{
		ID:            id,
		TeamID:        teamID,
		Status:        StatusUnattached,
		MountPath:     nil,
		ContainerName: nil,
	})
	if err != nil {
		return db.Volume{}, fmt.Errorf("update attachment: %w", err)
	}
	return updated, nil
}

// MoveRequest holds parameters for cross-server move.
type MoveRequest struct {
	TeamID         uuid.UUID
	VolumeID       uuid.UUID
	TargetServerID uuid.UUID
}

// Move copies the volume's data to a new server in the same cluster via rsync.
func (s *Service) Move(ctx context.Context, req MoveRequest) (db.Volume, error) {
	vol, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: req.VolumeID, TeamID: req.TeamID})
	if err != nil {
		return db.Volume{}, fmt.Errorf("get volume: %w", err)
	}
	if vol.Status != StatusUnattached && vol.Status != StatusAttached {
		return db.Volume{}, fmt.Errorf("cannot move volume in status %q", vol.Status)
	}
	if req.TargetServerID == vol.ServerID {
		return db.Volume{}, errors.New("target server is the same as current server")
	}

	target, err := s.queries.GetClusterMemberByServerID(ctx, req.TargetServerID)
	if err != nil {
		return db.Volume{}, fmt.Errorf("target server is not part of any cluster: %w", err)
	}
	if target.ClusterID != vol.ClusterID {
		return db.Volume{}, errors.New("target server is in a different cluster")
	}

	previousStatus := vol.Status
	if _, err := s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
		ID: vol.ID, TeamID: req.TeamID, Status: StatusMoving,
	}); err != nil {
		return db.Volume{}, fmt.Errorf("mark moving: %w", err)
	}

	requestID := uuid.NewString()
	cmd := &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_VolumeMove{
			VolumeMove: &agentv1.VolumeMoveCommand{
				RequestId:         requestID,
				VolumeId:          vol.ID.String(),
				SourcePath:        vol.HostPath,
				TargetWireguardIp: target.WireguardIp.String(),
				TargetPath:        volumeHostPath(vol.ID),
			},
		},
	}

	res, err := s.dispatch(ctx, req.TeamID, vol.ServerID, requestID, cmd)
	if err != nil || (res != nil && !res.Success) {
		_, _ = s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
			ID: vol.ID, TeamID: req.TeamID, Status: StatusError,
		})
		errMsg := ""
		if err != nil {
			errMsg = err.Error()
		}
		if res != nil && res.Error != "" {
			errMsg = res.Error
		}
		return db.Volume{}, fmt.Errorf("move failed: %s", errMsg)
	}

	updated, err := s.queries.UpdateVolumeServer(ctx, db.UpdateVolumeServerParams{
		ID:       vol.ID,
		TeamID:   req.TeamID,
		ServerID: req.TargetServerID,
		Status:   previousStatus,
	})
	if err != nil {
		return db.Volume{}, fmt.Errorf("update server: %w", err)
	}
	return updated, nil
}

// Snapshot creates a tarball snapshot of the volume on its host server.
func (s *Service) Snapshot(ctx context.Context, teamID, id uuid.UUID) (db.VolumeSnapshot, error) {
	vol, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: id, TeamID: teamID})
	if err != nil {
		return db.VolumeSnapshot{}, fmt.Errorf("get volume: %w", err)
	}

	previousStatus := vol.Status
	if _, err := s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
		ID: vol.ID, TeamID: teamID, Status: StatusSnapshotting,
	}); err != nil {
		return db.VolumeSnapshot{}, fmt.Errorf("mark snapshotting: %w", err)
	}
	defer func() {
		_, _ = s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
			ID: vol.ID, TeamID: teamID, Status: previousStatus,
		})
	}()

	snapshotID := uuid.New()
	outputPath := snapshotOutputPath(snapshotID)
	requestID := uuid.NewString()
	cmd := &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_VolumeSnapshot{
			VolumeSnapshot: &agentv1.VolumeSnapshotCommand{
				RequestId:  requestID,
				VolumeId:   vol.ID.String(),
				SourcePath: vol.HostPath,
				SnapshotId: snapshotID.String(),
				OutputPath: outputPath,
			},
		},
	}

	res, err := s.dispatch(ctx, teamID, vol.ServerID, requestID, cmd)
	if err != nil {
		return db.VolumeSnapshot{}, fmt.Errorf("snapshot dispatch: %w", err)
	}
	if res != nil && !res.Success {
		return db.VolumeSnapshot{}, fmt.Errorf("snapshot failed: %s", res.Error)
	}

	sizeBytes := int64(0)
	storagePath := outputPath
	if res != nil {
		sizeBytes = res.SizeBytes
		if res.SnapshotPath != "" {
			storagePath = res.SnapshotPath
		}
	}

	snap, err := s.queries.CreateVolumeSnapshot(ctx, db.CreateVolumeSnapshotParams{
		VolumeID:    vol.ID,
		SizeBytes:   sizeBytes,
		StorageType: "local",
		StoragePath: storagePath,
	})
	if err != nil {
		return db.VolumeSnapshot{}, fmt.Errorf("record snapshot: %w", err)
	}
	return snap, nil
}

// Resize updates the declared size of a volume (soft quota).
func (s *Service) Resize(ctx context.Context, teamID, id uuid.UUID, newSizeGB int32) (db.Volume, error) {
	vol, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: id, TeamID: teamID})
	if err != nil {
		return db.Volume{}, fmt.Errorf("get volume: %w", err)
	}
	if newSizeGB <= vol.SizeGb {
		return db.Volume{}, fmt.Errorf("new size must be greater than current size (%d GB)", vol.SizeGb)
	}

	previousStatus := vol.Status
	if _, err := s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
		ID: vol.ID, TeamID: teamID, Status: StatusResizing,
	}); err != nil {
		return db.Volume{}, fmt.Errorf("mark resizing: %w", err)
	}

	requestID := uuid.NewString()
	cmd := &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_VolumeResize{
			VolumeResize: &agentv1.VolumeResizeCommand{
				RequestId: requestID,
				VolumeId:  vol.ID.String(),
				HostPath:  vol.HostPath,
				NewSizeGb: newSizeGB,
			},
		},
	}

	res, err := s.dispatch(ctx, teamID, vol.ServerID, requestID, cmd)
	if err != nil {
		_, _ = s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
			ID: vol.ID, TeamID: teamID, Status: previousStatus,
		})
		return db.Volume{}, fmt.Errorf("resize dispatch: %w", err)
	}
	if res != nil && !res.Success {
		_, _ = s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
			ID: vol.ID, TeamID: teamID, Status: previousStatus,
		})
		return db.Volume{}, fmt.Errorf("resize failed: %s", res.Error)
	}

	updated, err := s.queries.UpdateVolumeSize(ctx, db.UpdateVolumeSizeParams{
		ID: vol.ID, TeamID: teamID, SizeGb: newSizeGB,
	})
	if err != nil {
		return db.Volume{}, fmt.Errorf("update size: %w", err)
	}
	if res != nil && res.UsedBytes > 0 {
		_ = s.queries.UpdateVolumeUsage(ctx, db.UpdateVolumeUsageParams{ID: vol.ID, UsedBytes: res.UsedBytes})
	}
	_, _ = s.queries.UpdateVolumeStatus(ctx, db.UpdateVolumeStatusParams{
		ID: vol.ID, TeamID: teamID, Status: previousStatus,
	})
	return updated, nil
}

// ListSnapshots returns every snapshot for a volume.
func (s *Service) ListSnapshots(ctx context.Context, teamID, volumeID uuid.UUID) ([]db.VolumeSnapshot, error) {
	if _, err := s.queries.GetVolume(ctx, db.GetVolumeParams{ID: volumeID, TeamID: teamID}); err != nil {
		return nil, fmt.Errorf("get volume: %w", err)
	}
	return s.queries.ListVolumeSnapshots(ctx, volumeID)
}

// HandleResult is invoked by the agent control plane when an agent returns a
// VolumeResult message. It correlates the result with any in-flight dispatch.
func (s *Service) HandleResult(ctx context.Context, result *agentv1.VolumeResult) {
	if result == nil || result.RequestId == "" {
		return
	}
	if result.UsedBytes > 0 {
		if vid, err := uuid.Parse(result.VolumeId); err == nil {
			_ = s.queries.UpdateVolumeUsage(ctx, db.UpdateVolumeUsageParams{ID: vid, UsedBytes: result.UsedBytes})
		}
	}
	s.mu.Lock()
	ch, ok := s.pending[result.RequestId]
	if ok {
		delete(s.pending, result.RequestId)
	}
	s.mu.Unlock()
	if !ok {
		return
	}
	select {
	case ch <- result:
	default:
	}
}

// dispatch sends a ControlMessage to the agent on the given server and waits
// for a VolumeResult correlated by request_id.
func (s *Service) dispatch(ctx context.Context, teamID, serverID uuid.UUID, requestID string, msg *agentv1.ControlMessage) (*agentv1.VolumeResult, error) {
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: serverID, TeamID: teamID})
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		return nil, fmt.Errorf("server %s has no connected agent", serverID)
	}

	ch := make(chan *agentv1.VolumeResult, 1)
	s.mu.Lock()
	s.pending[requestID] = ch
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.pending, requestID)
		s.mu.Unlock()
	}()

	if err := s.connMgr.SendToAgent(*srv.AgentID, msg); err != nil {
		return nil, fmt.Errorf("send to agent: %w", err)
	}

	timeout := agentResultTimeout
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 && remaining < timeout {
			timeout = remaining
		}
	}

	select {
	case res := <-ch:
		return res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(timeout):
		return nil, fmt.Errorf("timed out waiting for agent result")
	}
}

// volumeHostPath returns the canonical on-disk path for a volume ID.
func volumeHostPath(id uuid.UUID) string {
	return strings.TrimRight(HostPathRoot, "/") + "/" + id.String()
}

// snapshotOutputPath returns the canonical tarball path for a snapshot ID.
func snapshotOutputPath(id uuid.UUID) string {
	return strings.TrimRight(SnapshotPathRoot, "/") + "/" + id.String() + ".tar.gz"
}
