package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

func main() {
	var (
		server = flag.String("server", "localhost:9090", "control-plane gRPC address")
		id     = flag.String("id", "", "agent ID (defaults to hostname)")
	)
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	agentID := *id
	if agentID == "" {
		host, err := os.Hostname()
		if err != nil {
			logger.Error("failed to get hostname", "err", err)
			os.Exit(1)
		}
		agentID = host
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	client := NewClient(*server, agentID, logger)
	defer client.Close()

	logger.Info("starting agent", "id", agentID, "server", *server)

	for {
		stream, err := client.ConnectWithRetry(ctx)
		if err != nil {
			// ctx cancelled — clean shutdown
			logger.Info("agent shutting down")
			return
		}

		// Send initial heartbeat immediately.
		go RunHeartbeat(agentID, stream, logger)

		// Process control messages from the server.
		if err := receiveLoop(ctx, stream, client, logger); err != nil {
			logger.Warn("stream error, reconnecting", "err", err)
			// Loop will reconnect via ConnectWithRetry.
			client.Close()
			client = NewClient(*server, agentID, logger)
		}

		// Check if context cancelled before reconnecting.
		select {
		case <-ctx.Done():
			logger.Info("agent shutting down")
			return
		default:
		}
	}
}

// receiveLoop reads ControlMessages from the server stream until error or EOF.
func receiveLoop(
	ctx context.Context,
	stream agentv1.AgentService_ConnectClient,
	_ *Client,
	logger *slog.Logger,
) error {
	for {
		msg, err := stream.Recv()
		if err != nil {
			return err
		}

		switch p := msg.Payload.(type) {
		case *agentv1.ControlMessage_ExecCommand:
			go HandleExecCommand(ctx, p.ExecCommand, stream, logger)

		case *agentv1.ControlMessage_FileTransfer:
			logger.Info("file transfer request",
				"transfer_id", p.FileTransfer.TransferId,
				"path", p.FileTransfer.Path,
				"direction", p.FileTransfer.Direction,
			)

		case *agentv1.ControlMessage_CertRotation:
			logger.Info("cert rotation received")

		case *agentv1.ControlMessage_ProvisionCommand:
			logger.Info("provision command received",
				"job_id", p.ProvisionCommand.JobId,
				"component", p.ProvisionCommand.Component,
			)
			go HandleProvisionCommand(ctx, p.ProvisionCommand, stream)

		case *agentv1.ControlMessage_SshKeyInstall:
			logger.Info("ssh key install command received",
				"action", p.SshKeyInstall.Action,
			)
			go HandleSSHKeyInstall(ctx, p.SshKeyInstall, stream, logger)

		default:
			logger.Warn("unknown control message payload")
		}
	}
}
