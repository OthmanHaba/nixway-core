package agent

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements agentv1.AgentServiceServer.
type Server struct {
	agentv1.UnimplementedAgentServiceServer
	conn    *ConnManager
	queries *db.Queries
	redis   *redis.Client
	logger  *slog.Logger
}

func NewServer(conn *ConnManager, queries *db.Queries, redisClient *redis.Client, logger *slog.Logger) *Server {
	return &Server{conn: conn, queries: queries, redis: redisClient, logger: logger}
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
