package main

import (
	"log/slog"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const heartbeatInterval = 10 * time.Second

// RunHeartbeat sends a heartbeat and a ResourceReport over stream every
// heartbeatInterval until the stream context is cancelled or a send error occurs.
func RunHeartbeat(agentID string, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	// Send an initial resource report immediately on connect.
	sendResourceReport(agentID, stream, logger)

	for {
		select {
		case <-stream.Context().Done():
			logger.Info("heartbeat stopped: stream context done")
			return
		case t := <-ticker.C:
			// Heartbeat — keeps ConnManager session alive.
			hb := &agentv1.AgentMessage{
				Payload: &agentv1.AgentMessage_Heartbeat{
					Heartbeat: &agentv1.Heartbeat{
						AgentId:   agentID,
						Timestamp: timestamppb.New(t),
					},
				},
			}
			if err := stream.Send(hb); err != nil {
				logger.Warn("heartbeat send failed", "err", err)
				return
			}
			logger.Debug("heartbeat sent", "agent_id", agentID)

			// ResourceReport — periodically refresh resource data.
			sendResourceReport(agentID, stream, logger)
			sendHealthReport(agentID, stream, logger)
			sendMetricReport(agentID, stream, logger)
		}
	}
}

func sendResourceReport(agentID string, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	report := collectResources()
	report.AgentId = agentID
	msg := &agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ResourceReport{
			ResourceReport: report,
		},
	}
	if err := stream.Send(msg); err != nil {
		logger.Warn("resource report send failed", "err", err)
	} else {
		logger.Debug("resource report sent", "agent_id", agentID)
	}
}

func sendMetricReport(agentID string, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	report := collectContainerMetrics()
	report.AgentId = agentID
	if len(report.Containers) == 0 {
		return
	}
	msg := &agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_MetricReport{
			MetricReport: report,
		},
	}
	if err := stream.Send(msg); err != nil {
		logger.Warn("metric report send failed", "err", err)
	} else {
		logger.Debug("metric report sent", "agent_id", agentID, "containers", len(report.Containers))
	}
}

func sendHealthReport(agentID string, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	report := collectHealth()
	report.AgentId = agentID
	msg := &agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_HealthReport{
			HealthReport: report,
		},
	}
	if err := stream.Send(msg); err != nil {
		logger.Warn("health report send failed", "err", err)
	} else {
		logger.Debug("health report sent", "agent_id", agentID)
	}
}
