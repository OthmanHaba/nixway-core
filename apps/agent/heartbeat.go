package main

import (
	"log/slog"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const heartbeatInterval = 10 * time.Second

// RunHeartbeat sends a heartbeat over stream every heartbeatInterval until
// the stream context is cancelled or a send error occurs.
func RunHeartbeat(agentID string, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-stream.Context().Done():
			logger.Info("heartbeat stopped: stream context done")
			return
		case t := <-ticker.C:
			msg := &agentv1.AgentMessage{
				Payload: &agentv1.AgentMessage_Heartbeat{
					Heartbeat: &agentv1.Heartbeat{
						AgentId:   agentID,
						Timestamp: timestamppb.New(t),
					},
				},
			}
			if err := stream.Send(msg); err != nil {
				logger.Warn("heartbeat send failed", "err", err)
				return
			}
			logger.Debug("heartbeat sent", "agent_id", agentID)
		}
	}
}
