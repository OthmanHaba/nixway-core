package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// DeployTriggerer triggers a deploy after a successful build.
type DeployTriggerer interface {
	TriggerDeploy(ctx context.Context, appID, envID, buildID uuid.UUID, targetServerID ...*uuid.UUID) (db.Deployment, error)
}

// MeshRegenerator handles mesh lifecycle events with logging.
type MeshRegenerator interface {
	RegenerateMesh(ctx context.Context, clusterID uuid.UUID) error
	OnKeyGenResult(ctx context.Context, clusterID uuid.UUID, memberID uuid.UUID, serverName, publicKey string)
	OnApplyResult(ctx context.Context, clusterID uuid.UUID, memberID uuid.UUID, serverName string, success bool, errMsg string)
	OnTeardownResult(ctx context.Context, clusterID uuid.UUID, memberID uuid.UUID, serverName string, success bool)
}

// Server implements agentv1.AgentServiceServer.
type Server struct {
	agentv1.UnimplementedAgentServiceServer
	conn     *ConnManager
	queries  *db.Queries
	redis    *redis.Client
	logger   *slog.Logger
	meshReg  MeshRegenerator
	deployer DeployTriggerer
}

func NewServer(conn *ConnManager, queries *db.Queries, redisClient *redis.Client, logger *slog.Logger) *Server {
	return &Server{conn: conn, queries: queries, redis: redisClient, logger: logger}
}

// SetMeshRegenerator sets the mesh regenerator (called after wiring to avoid circular deps).
func (s *Server) SetMeshRegenerator(mr MeshRegenerator) {
	s.meshReg = mr
}

// SetDeployTriggerer sets the deploy triggerer (called after wiring to avoid circular deps).
func (s *Server) SetDeployTriggerer(dt DeployTriggerer) {
	s.deployer = dt
}

// Register handles agent registration, issuing an agent ID.
// In Phase 0 we skip real PKI — CSR is accepted but certs returned empty.
func (s *Server) Register(_ context.Context, req *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error) {
	if req.Hostname == "" {
		return nil, status.Error(codes.InvalidArgument, "hostname required")
	}
	agentID := uuid.New().String()
	s.conn.Register(agentID)
	s.logger.Info("agent registered via RPC",
		"agent_id", agentID,
		"hostname", req.Hostname,
		"os", req.Os,
		"arch", req.Arch,
	)
	return &agentv1.RegisterResponse{
		AgentId:       agentID,
		Certificate:   []byte{},
		CaCertificate: []byte{},
	}, nil
}

// Connect handles the bidirectional streaming RPC between agent and control plane.
func (s *Server) Connect(stream agentv1.AgentService_ConnectServer) error {
	var agentID string

	defer func() {
		if agentID != "" {
			s.conn.Disconnect(agentID)
		}
	}()

	for {
		msg, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		switch p := msg.Payload.(type) {
		case *agentv1.AgentMessage_Heartbeat:
			hb := p.Heartbeat
			if agentID == "" {
				agentID = hb.AgentId
				// Register if not yet known (agent may connect without Register).
				if s.conn.GetState(agentID) == nil {
					s.conn.Register(agentID)
				}
				// Store the stream so the control plane can push commands to this agent.
				s.conn.SetStream(agentID, stream)

				// Link agent to server: the installer sets --id to the server UUID,
				// so the agent sends heartbeats with the server ID. On first heartbeat,
				// update the server record's agent_id to complete the link.
				s.linkAgentToServer(stream.Context(), agentID)
			}
			s.conn.Heartbeat(hb.AgentId)
			s.logger.Debug("heartbeat received", "agent_id", hb.AgentId)

		case *agentv1.AgentMessage_ExecOutput:
			out := p.ExecOutput
			s.logger.Info("exec output",
				"agent_id", agentID,
				"command_id", out.CommandId,
				"finished", out.Finished,
				"exit_code", out.ExitCode,
			)

		case *agentv1.AgentMessage_HealthReport:
			hr := p.HealthReport
			if agentID == "" {
				agentID = hr.AgentId
			}
			s.logger.Info("health report",
				"agent_id", hr.AgentId,
				"cpu_percent", hr.CpuPercent,
				"mem_used", hr.MemoryUsed,
				"mem_total", hr.MemoryTotal,
			)

		case *agentv1.AgentMessage_FileChunk:
			fc := p.FileChunk
			s.logger.Debug("file chunk received",
				"transfer_id", fc.TransferId,
				"offset", fc.Offset,
				"last", fc.Last,
			)

		case *agentv1.AgentMessage_ResourceReport:
			rr := p.ResourceReport
			if agentID == "" {
				agentID = rr.AgentId
				if s.conn.GetState(agentID) == nil {
					s.conn.Register(agentID)
				}
				s.conn.SetStream(agentID, stream)
				s.linkAgentToServer(stream.Context(), agentID)
			}
			s.conn.Heartbeat(agentID)
			s.conn.UpdateResources(agentID, rr)
			s.logger.Info("resource report",
				"agent_id", agentID,
				"cpu_model", rr.CpuModel,
				"cpu_cores", rr.CpuCores,
				"mem_total", rr.MemoryTotal,
			)
			// Persist to DB
			s.handleResourceReport(stream.Context(), agentID, rr)

		case *agentv1.AgentMessage_ProvisionOutput:
			po := p.ProvisionOutput
			s.logger.Info("provision output",
				"agent_id", agentID,
				"job_id", po.JobId,
				"component", po.Component,
				"finished", po.Finished,
				"success", po.Success,
			)
			s.handleProvisionOutput(stream.Context(), po)

		case *agentv1.AgentMessage_SshKeyResult:
			kr := p.SshKeyResult
			s.logger.Info("ssh key install result",
				"agent_id", agentID,
				"success", kr.Success,
				"error", kr.Error,
			)

		case *agentv1.AgentMessage_WireguardKeygenResult:
			r := p.WireguardKeygenResult
			s.logger.Info("wireguard keygen result",
				"agent_id", agentID,
				"member_id", r.MemberId,
				"success", r.Success,
			)
			if r.Success {
				s.handleWireGuardKeyGenResult(stream.Context(), r)
			}

		case *agentv1.AgentMessage_WireguardApplyResult:
			r := p.WireguardApplyResult
			s.logger.Info("wireguard apply result",
				"agent_id", agentID,
				"member_id", r.MemberId,
				"success", r.Success,
			)
			if s.meshReg != nil {
				if mid, err := uuid.Parse(r.MemberId); err == nil {
					if member, err := s.queries.GetClusterMemberByID(stream.Context(), mid); err == nil {
						go s.meshReg.OnApplyResult(stream.Context(), member.ClusterID, mid, r.MemberId, r.Success, r.Error)
					}
				}
			}

		case *agentv1.AgentMessage_WireguardTeardownResult:
			r := p.WireguardTeardownResult
			s.logger.Info("wireguard teardown result",
				"agent_id", agentID,
				"member_id", r.MemberId,
				"success", r.Success,
			)
			if s.meshReg != nil {
				if mid, err := uuid.Parse(r.MemberId); err == nil {
					if member, err := s.queries.GetClusterMemberByID(stream.Context(), mid); err == nil {
						go s.meshReg.OnTeardownResult(stream.Context(), member.ClusterID, mid, r.MemberId, r.Success)
					}
				}
			}

		case *agentv1.AgentMessage_MeshHealthReport:
			mh := p.MeshHealthReport
			s.logger.Debug("mesh health report",
				"agent_id", agentID,
				"member_id", mh.MemberId,
				"peers", len(mh.Peers),
			)
			s.handleMeshHealthReport(stream.Context(), mh)

		case *agentv1.AgentMessage_DnsUpdateResult:
			r := p.DnsUpdateResult
			s.logger.Info("dns update result",
				"agent_id", agentID,
				"success", r.Success,
			)

		case *agentv1.AgentMessage_BuildOutput:
			bo := p.BuildOutput
			s.logger.Info("build output",
				"agent_id", agentID,
				"build_id", bo.BuildId,
				"phase", bo.Phase,
				"finished", bo.Finished,
				"success", bo.Success,
			)
			s.handleBuildOutput(stream.Context(), agentID, bo)

		case *agentv1.AgentMessage_DeployOutput:
			do := p.DeployOutput
			s.logger.Info("deploy output",
				"agent_id", agentID,
				"deploy_id", do.DeployId,
				"target_id", do.TargetId,
				"phase", do.Phase,
				"finished", do.Finished,
				"success", do.Success,
			)
			s.handleDeployOutput(stream.Context(), do)

		case *agentv1.AgentMessage_StopContainerResult:
			r := p.StopContainerResult
			s.logger.Info("stop container result",
				"agent_id", agentID,
				"container", r.ContainerName,
				"success", r.Success,
			)

		case *agentv1.AgentMessage_ImagePullResult:
			r := p.ImagePullResult
			s.logger.Info("image pull result",
				"agent_id", agentID,
				"transfer_id", r.TransferId,
				"success", r.Success,
			)

		case *agentv1.AgentMessage_ContainerLogsOutput:
			lo := p.ContainerLogsOutput
			if s.redis != nil {
				channel := "container-logs:" + lo.RequestId
				if len(lo.Output) > 0 {
					s.redis.Publish(stream.Context(), channel, string(lo.Output))
				}
				if lo.Finished {
					s.redis.Publish(stream.Context(), channel, "__done__")
				}
			}

		case *agentv1.AgentMessage_ContainerExecOutput:
			eo := p.ContainerExecOutput
			if s.redis != nil {
				channel := "exec:" + eo.SessionId
				if len(eo.Data) > 0 {
					s.redis.Publish(stream.Context(), channel, string(eo.Data))
				}
				if eo.Finished {
					s.redis.Publish(stream.Context(), channel, "__done__")
				}
			}

		case *agentv1.AgentMessage_RestartContainerResult:
			r := p.RestartContainerResult
			s.logger.Info("restart container result",
				"agent_id", agentID,
				"container", r.ContainerName,
				"success", r.Success,
			)

		case *agentv1.AgentMessage_ContainerInspectResult:
			ir := p.ContainerInspectResult
			if s.redis != nil {
				data, _ := json.Marshal(ir)
				s.redis.Publish(stream.Context(), "inspect:"+ir.RequestId, string(data))
			}

		case *agentv1.AgentMessage_ServerLogsOutput:
			slo := p.ServerLogsOutput
			if s.redis != nil {
				channel := "server-logs:" + slo.RequestId
				if len(slo.Output) > 0 {
					s.redis.Publish(stream.Context(), channel, string(slo.Output))
				}
				if slo.Finished {
					s.redis.Publish(stream.Context(), channel, "__done__")
				}
			}

		case *agentv1.AgentMessage_ServerCleanupResult:
			cr := p.ServerCleanupResult
			s.logger.Info("server cleanup result",
				"agent_id", agentID,
				"request_id", cr.RequestId,
				"success", cr.Success,
			)
			if s.redis != nil {
				data, _ := json.Marshal(cr)
				s.redis.Publish(stream.Context(), "server-cleanup:"+cr.RequestId, string(data))
			}

		default:
			s.logger.Warn("unknown agent message payload type")
		}
	}
}

// linkAgentToServer attempts to link an agent to its server record.
// The agent's ID is the server UUID (set by the installer's --id flag).
// We update the server's agent_id field so future lookups by agent_id work.
func (s *Server) linkAgentToServer(ctx context.Context, agentID string) {
	if s.queries == nil {
		return
	}

	serverUUID, err := uuid.Parse(agentID)
	if err != nil {
		s.logger.Debug("agent ID is not a valid server UUID, skipping link", "agent_id", agentID)
		return
	}

	if err := s.queries.UpdateServerAgentID(ctx, db.UpdateServerAgentIDParams{
		ID:      serverUUID,
		AgentID: &agentID,
	}); err != nil {
		s.logger.Debug("failed to link agent to server", "agent_id", agentID, "error", err)
		return
	}

	s.logger.Info("linked agent to server", "agent_id", agentID, "server_id", serverUUID)
}

func (s *Server) handleResourceReport(ctx context.Context, agentID string, rr *agentv1.ResourceReport) {
	if s.queries == nil {
		return
	}

	srv, err := s.queries.GetServerByAgentID(ctx, &agentID)
	if err != nil {
		s.logger.Debug("server not found for agent", "agent_id", agentID, "error", err)
		return
	}

	// Update last_seen_at
	_ = s.queries.UpdateServerStatus(ctx, db.UpdateServerStatusParams{
		ID:         srv.ID,
		Status:     "online",
		LastSeenAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})

	// Marshal disks and network interfaces to JSON
	disksJSON, _ := json.Marshal(rr.GetDisks())
	nicsJSON, _ := json.Marshal(rr.GetNetworkInterfaces())

	cpuModel := rr.GetCpuModel()
	cpuCores := rr.GetCpuCores()
	memTotal := int64(rr.GetMemoryTotal())
	memAvail := int64(rr.GetMemoryAvailable())
	kernelVer := rr.GetKernelVersion()
	dockerVer := rr.GetDockerVersion()

	_ = s.queries.UpsertServerResources(ctx, db.UpsertServerResourcesParams{
		ServerID:          srv.ID,
		CpuModel:          &cpuModel,
		CpuCores:          &cpuCores,
		MemoryTotal:       &memTotal,
		MemoryAvailable:   &memAvail,
		KernelVersion:     &kernelVer,
		DockerVersion:     &dockerVer,
		Disks:             disksJSON,
		NetworkInterfaces: nicsJSON,
	})
}

func (s *Server) handleProvisionOutput(ctx context.Context, po *agentv1.ProvisionOutput) {
	jobID, err := uuid.Parse(po.JobId)
	if err != nil {
		s.logger.Warn("invalid job_id in provision output", "job_id", po.JobId)
		return
	}

	// Publish to Redis for SSE consumers
	if s.redis != nil {
		payload, _ := json.Marshal(map[string]any{
			"component": po.Component,
			"output":    string(po.Output),
			"finished":  po.Finished,
			"success":   po.Success,
			"error":     po.Error,
		})
		s.redis.Publish(ctx, "provision:"+jobID.String(), string(payload))
	}

	// Append to provisioning_jobs.logs
	if s.queries != nil {
		_ = s.queries.AppendProvisioningLog(ctx, db.AppendProvisioningLogParams{
			ID:   jobID,
			Logs: string(po.Output),
		})

		// If finished, update job status
		if po.Finished {
			jobStatus := "completed"
			var jobErr *string
			if !po.Success {
				jobStatus = "failed"
				errMsg := po.Error
				jobErr = &errMsg
			}
			_ = s.queries.UpdateProvisioningJobStatus(ctx, db.UpdateProvisioningJobStatusParams{
				ID:          jobID,
				Status:      jobStatus,
				CompletedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
				Error:       jobErr,
			})
		}
	}
}

func (s *Server) handleWireGuardKeyGenResult(ctx context.Context, r *agentv1.WireGuardKeyGenResult) {
	if s.queries == nil {
		return
	}

	memberID, err := uuid.Parse(r.MemberId)
	if err != nil {
		s.logger.Warn("invalid member_id in keygen result", "member_id", r.MemberId)
		return
	}

	if err := s.queries.UpdateClusterMemberPublicKey(ctx, db.UpdateClusterMemberPublicKeyParams{
		ID:                 memberID,
		WireguardPublicKey: r.PublicKey,
	}); err != nil {
		s.logger.Error("failed to update member public key", "member_id", r.MemberId, "error", err)
		return
	}

	s.logger.Info("stored WireGuard public key", "member_id", r.MemberId)

	// Trigger mesh regeneration via mesh manager (which logs + streams)
	if s.meshReg != nil {
		member, err := s.queries.GetClusterMemberByID(ctx, memberID)
		if err == nil {
			go s.meshReg.OnKeyGenResult(ctx, member.ClusterID, memberID, r.MemberId, r.PublicKey)
		}
	}
}

func (s *Server) handleBuildOutput(ctx context.Context, agentID string, bo *agentv1.BuildOutput) {
	if s.redis == nil {
		return
	}

	buildID := bo.BuildId
	channel := "build:" + buildID

	// Stream log output to Redis for SSE consumers
	if len(bo.Output) > 0 {
		s.redis.Publish(ctx, channel, string(bo.Output))
	}

	// Append logs to DB
	if s.queries != nil && len(bo.Output) > 0 {
		bid, err := uuid.Parse(buildID)
		if err == nil {
			_ = s.queries.AppendBuildLogs(ctx, db.AppendBuildLogsParams{
				ID:   bid,
				Logs: string(bo.Output),
			})
		}
	}

	// Update build status from phase (cloning → building)
	if !bo.Finished && s.queries != nil && bo.Phase != "" {
		bid, err := uuid.Parse(buildID)
		if err == nil {
			phaseStatus := bo.Phase // "cloning", "detecting", "building"
			if phaseStatus == "detecting" {
				phaseStatus = "building"
			}
			_ = s.queries.UpdateBuildStatus(ctx, db.UpdateBuildStatusParams{
				ID:        bid,
				Status:    phaseStatus,
				StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
			})
		}
	}

	// If finished, update build status and signal done
	if bo.Finished && s.queries != nil {
		bid, err := uuid.Parse(buildID)
		if err != nil {
			return
		}

		status := "built"
		var errPtr *string
		if !bo.Success {
			status = "failed"
			errMsg := bo.Error
			errPtr = &errMsg
		}

		// Resolve server ID from agent ID
		serverID := pgtype.UUID{}
		if sid, err := uuid.Parse(agentID); err == nil {
			serverID = pgtype.UUID{Bytes: sid, Valid: true}
		}

		_ = s.queries.CompleteBuild(ctx, db.CompleteBuildParams{
			ID:       bid,
			Status:   status,
			ImageTag: bo.ImageId,
			ServerID: serverID,
			Error:    errPtr,
		})

		s.redis.Publish(ctx, channel, "__done__")

		// Auto-trigger deploy on successful build
		if bo.Success && s.deployer != nil {
			build, err := s.queries.GetBuild(ctx, bid)
			if err == nil {
				go func() {
					_, deployErr := s.deployer.TriggerDeploy(context.Background(), build.AppID, build.EnvironmentID, bid)
					if deployErr != nil {
						s.logger.Error("auto-deploy failed", "build_id", buildID, "error", deployErr)
					} else {
						s.logger.Info("auto-deploy triggered after build", "build_id", buildID)
					}
				}()
			}
		}
	}
}

func (s *Server) handleDeployOutput(ctx context.Context, do *agentv1.DeployOutput) {
	if s.queries == nil {
		return
	}

	targetID, err := uuid.Parse(do.TargetId)
	if err != nil {
		return
	}
	deployID := do.DeployId

	// Update target status
	status := do.Phase
	var healthyAt, stoppedAt pgtype.Timestamptz
	var startedAt pgtype.Timestamptz
	if status != "pending" {
		startedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}
	if do.Phase == "healthy" {
		healthyAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}

	var errPtr *string
	if do.Error != "" {
		errMsg := do.Error
		errPtr = &errMsg
	}

	var containerPtr *string
	if do.ContainerId != "" {
		cid := do.ContainerId
		containerPtr = &cid
	}

	_ = s.queries.UpdateDeploymentTargetStatus(ctx, db.UpdateDeploymentTargetStatusParams{
		ID:                  targetID,
		Status:              status,
		ContainerID:         containerPtr,
		StartedAt:           startedAt,
		HealthyAt:           healthyAt,
		StoppedAt:           stoppedAt,
		HealthCheckAttempts: 0,
		Error:               errPtr,
	})

	// Persist logs and publish to Redis for SSE
	if s.redis != nil {
		channel := "deploy:" + deployID
		msg := fmt.Sprintf("[%s] target %s: %s", do.Phase, do.TargetId, do.Phase)
		if do.Error != "" {
			msg += " - " + do.Error
		}
		msg += "\n"

		// Persist to DB
		if did, err := uuid.Parse(deployID); err == nil {
			_ = s.queries.AppendDeploymentLogs(ctx, db.AppendDeploymentLogsParams{
				ID:   did,
				Logs: msg,
			})
		}

		s.redis.Publish(ctx, channel, msg)
	}

	// If finished, update deployment-level status
	if do.Finished {
		did, err := uuid.Parse(deployID)
		if err != nil {
			return
		}

		if do.Success {
			// Increment replicas ready
			_ = s.queries.IncrementReplicasReady(ctx, did)

			// Check if all targets are done
			deployment, err := s.queries.GetDeployment(ctx, did)
			if err == nil && deployment.ReplicasReady+1 >= deployment.ReplicasDesired {
				_ = s.queries.CompleteDeployment(ctx, db.CompleteDeploymentParams{
					ID:     did,
					Status: "healthy",
				})
				if s.redis != nil {
					s.redis.Publish(ctx, "deploy:"+deployID, "__done__")
				}
			}
		} else {
			// Target failed — mark deployment as failed
			errMsg := do.Error
			_ = s.queries.CompleteDeployment(ctx, db.CompleteDeploymentParams{
				ID:     did,
				Status: "failed",
				Error:  &errMsg,
			})
			if s.redis != nil {
				s.redis.Publish(ctx, "deploy:"+deployID, "__done__")
			}
		}
	}
}

func (s *Server) handleMeshHealthReport(ctx context.Context, mh *agentv1.MeshHealthReport) {
	if s.queries == nil {
		return
	}

	memberID, err := uuid.Parse(mh.MemberId)
	if err != nil {
		s.logger.Warn("invalid member_id in mesh health", "member_id", mh.MemberId)
		return
	}

	// Look up the reporting member to get the cluster ID
	member, err := s.queries.GetClusterMemberByID(ctx, memberID)
	if err != nil {
		s.logger.Warn("could not find cluster member", "member_id", mh.MemberId, "error", err)
		return
	}

	for _, p := range mh.Peers {
		// Resolve peer member ID: agent doesn't know it, so look up by WireGuard IP
		var peerMemberID uuid.UUID
		if p.PeerMemberId != "" {
			peerMemberID, err = uuid.Parse(p.PeerMemberId)
			if err != nil {
				continue
			}
		} else if p.PeerIp != "" {
			peerAddr, err := netip.ParseAddr(p.PeerIp)
			if err != nil {
				s.logger.Debug("invalid peer IP", "peer_ip", p.PeerIp, "error", err)
				continue
			}
			peerMember, err := s.queries.GetClusterMemberByClusterAndIP(ctx, db.GetClusterMemberByClusterAndIPParams{
				ClusterID:   member.ClusterID,
				WireguardIp: peerAddr,
			})
			if err != nil {
				s.logger.Debug("could not resolve peer by IP", "peer_ip", p.PeerIp, "error", err)
				continue
			}
			peerMemberID = peerMember.ID
		} else {
			continue
		}

		status := "active"
		if !p.Reachable {
			status = "failed"
		} else if p.LastHandshakeSeconds > 300 || p.RttMs > 500 {
			status = "degraded"
		}

		var handshakeAt pgtype.Timestamptz
		if p.Reachable && p.LastHandshakeSeconds > 0 {
			handshakeAt = pgtype.Timestamptz{
				Time:  time.Now().Add(-time.Duration(p.LastHandshakeSeconds) * time.Second),
				Valid: true,
			}
		}

		rttMs := int32(p.RttMs)
		_ = s.queries.UpdatePeerHealth(ctx, db.UpdatePeerHealthParams{
			MemberID:        memberID,
			PeerMemberID:    peerMemberID,
			Status:          status,
			LastHandshakeAt: handshakeAt,
			RttMs:           &rttMs,
		})
	}
}
