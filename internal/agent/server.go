package agent

import (
	"context"
	"io"
	"log/slog"

	"github.com/google/uuid"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements agentv1.AgentServiceServer.
type Server struct {
	agentv1.UnimplementedAgentServiceServer
	conn   *ConnManager
	logger *slog.Logger
}

func NewServer(conn *ConnManager, logger *slog.Logger) *Server {
	return &Server{conn: conn, logger: logger}
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

		default:
			s.logger.Warn("unknown agent message payload type")
		}
	}
}
