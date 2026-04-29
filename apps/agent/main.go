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
		server        = flag.String("server", "localhost:9090", "control-plane gRPC address")
		id            = flag.String("id", "", "agent ID (defaults to hostname)")
		metricsListen = flag.String("metrics-listen", ":9100", "Prometheus metrics listen address")
		metricsPath   = flag.String("metrics-path", "/metrics", "Prometheus metrics path")
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
	StartMetricsServer(ctx, agentID, *metricsListen, *metricsPath, logger)

	// Re-mount any loopback-backed volumes that exist on disk. Containers
	// with `--restart unless-stopped` may have been brought back by Docker
	// before the agent could mount their backing image; this closes that
	// gap on every agent boot.
	reconcileVolumeMounts(ctx, logger)

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
		if err := receiveLoop(ctx, stream, client, agentID, logger); err != nil {
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
	agentID string,
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

		case *agentv1.ControlMessage_WireguardKeygen:
			logger.Info("wireguard keygen command received",
				"member_id", p.WireguardKeygen.MemberId,
			)
			go HandleWireGuardKeyGen(ctx, p.WireguardKeygen, stream, logger)

		case *agentv1.ControlMessage_WireguardApply:
			logger.Info("wireguard apply command received",
				"member_id", p.WireguardApply.MemberId,
			)
			go HandleWireGuardApply(ctx, p.WireguardApply, stream, agentID, logger)

		case *agentv1.ControlMessage_WireguardTeardown:
			logger.Info("wireguard teardown command received",
				"member_id", p.WireguardTeardown.MemberId,
			)
			go HandleWireGuardTeardown(ctx, p.WireguardTeardown, stream, logger)

		case *agentv1.ControlMessage_DnsUpdateHosts:
			logger.Info("dns update command received",
				"cluster_slug", p.DnsUpdateHosts.ClusterSlug,
			)
			go HandleDNSUpdate(ctx, p.DnsUpdateHosts, stream, logger)

		case *agentv1.ControlMessage_BuildCommand:
			logger.Info("build command received",
				"build_id", p.BuildCommand.BuildId,
				"builder", p.BuildCommand.Builder,
			)
			go HandleBuildCommand(ctx, p.BuildCommand, stream, logger)

		case *agentv1.ControlMessage_DeployCommand:
			logger.Info("deploy command received",
				"deploy_id", p.DeployCommand.DeployId,
				"image_tag", p.DeployCommand.ImageTag,
			)
			go HandleDeployCommand(ctx, p.DeployCommand, stream, logger)

		case *agentv1.ControlMessage_StopContainer:
			logger.Info("stop container command received",
				"container", p.StopContainer.ContainerName,
			)
			go HandleStopContainerCommand(ctx, p.StopContainer, stream, logger)

		case *agentv1.ControlMessage_ImagePull:
			logger.Info("image pull command received",
				"image_tag", p.ImagePull.ImageTag,
				"source", p.ImagePull.SourceServerIp,
			)
			go HandleImagePullCommand(ctx, p.ImagePull, stream, logger)

		case *agentv1.ControlMessage_ContainerLogs:
			logger.Info("container logs command received",
				"container", p.ContainerLogs.ContainerName,
				"follow", p.ContainerLogs.Follow,
			)
			go HandleContainerLogsCommand(ctx, p.ContainerLogs, stream, logger)

		case *agentv1.ControlMessage_ContainerExec:
			logger.Info("container exec command received",
				"session_id", p.ContainerExec.SessionId,
				"container", p.ContainerExec.ContainerName,
			)
			go HandleContainerExecCommand(ctx, p.ContainerExec, stream, logger)

		case *agentv1.ControlMessage_ContainerExecInput:
			RouteExecInput(p.ContainerExecInput, logger)

		case *agentv1.ControlMessage_RestartContainer:
			logger.Info("restart container command received",
				"container", p.RestartContainer.ContainerName,
			)
			go HandleRestartContainerCommand(ctx, p.RestartContainer, stream, logger)

		case *agentv1.ControlMessage_ContainerInspect:
			logger.Info("container inspect command received",
				"container", p.ContainerInspect.ContainerName,
			)
			go HandleContainerInspectCommand(ctx, p.ContainerInspect, stream, logger)

		case *agentv1.ControlMessage_ServerLogs:
			logger.Info("server logs command received",
				"unit", p.ServerLogs.Unit,
				"follow", p.ServerLogs.Follow,
			)
			go HandleServerLogsCommand(ctx, p.ServerLogs, stream, logger)

		case *agentv1.ControlMessage_ServerCleanup:
			logger.Info("server cleanup command received",
				"request_id", p.ServerCleanup.RequestId,
			)
			go HandleServerCleanupCommand(ctx, p.ServerCleanup, stream, logger)

		case *agentv1.ControlMessage_TrafficRoute:
			logger.Info("traffic route command received",
				"request_id", p.TrafficRoute.RequestId,
				"app", p.TrafficRoute.AppSlug,
			)
			go HandleTrafficRouteCommand(ctx, p.TrafficRoute, stream, logger)

		case *agentv1.ControlMessage_VolumeCreate:
			logger.Info("volume create command received", "volume_id", p.VolumeCreate.VolumeId)
			go HandleVolumeCreate(ctx, p.VolumeCreate, stream, logger)

		case *agentv1.ControlMessage_VolumeDelete:
			logger.Info("volume delete command received", "volume_id", p.VolumeDelete.VolumeId)
			go HandleVolumeDelete(ctx, p.VolumeDelete, stream, logger)

		case *agentv1.ControlMessage_VolumeMove:
			logger.Info("volume move command received", "volume_id", p.VolumeMove.VolumeId, "target", p.VolumeMove.TargetWireguardIp)
			go HandleVolumeMove(ctx, p.VolumeMove, stream, logger)

		case *agentv1.ControlMessage_VolumeSnapshot:
			logger.Info("volume snapshot command received", "volume_id", p.VolumeSnapshot.VolumeId)
			go HandleVolumeSnapshot(ctx, p.VolumeSnapshot, stream, logger)

		case *agentv1.ControlMessage_VolumeResize:
			logger.Info("volume resize command received", "volume_id", p.VolumeResize.VolumeId)
			go HandleVolumeResize(ctx, p.VolumeResize, stream, logger)

		case *agentv1.ControlMessage_DatabaseAlterUser:
			logger.Info("database alter user command received",
				"database_id", p.DatabaseAlterUser.DatabaseId,
				"container", p.DatabaseAlterUser.ContainerName,
				"db_type", p.DatabaseAlterUser.DatabaseType,
			)
			go HandleDatabaseAlterUser(ctx, p.DatabaseAlterUser, stream, logger)

		case *agentv1.ControlMessage_DatabaseQuery:
			logger.Info("database query command received",
				"database_id", p.DatabaseQuery.DatabaseId,
				"db_type", p.DatabaseQuery.DatabaseType,
				"operation", p.DatabaseQuery.Operation,
				"write_mode", p.DatabaseQuery.WriteMode,
			)
			go HandleDatabaseQuery(ctx, p.DatabaseQuery, stream, logger)

		case *agentv1.ControlMessage_Backup:
			logger.Info("backup command received",
				"backup_id", p.Backup.BackupId,
				"database_id", p.Backup.DatabaseId,
				"container", p.Backup.ContainerName,
				"tool", p.Backup.Tool,
			)
			go HandleBackup(ctx, p.Backup, stream, logger)

		case *agentv1.ControlMessage_Restore:
			logger.Info("restore command received",
				"backup_id", p.Restore.BackupId,
				"database_id", p.Restore.DatabaseId,
				"container", p.Restore.ContainerName,
				"tool", p.Restore.Tool,
			)
			go HandleRestore(ctx, p.Restore, stream, logger)

		default:
			logger.Warn("unknown control message payload")
		}
	}
}
