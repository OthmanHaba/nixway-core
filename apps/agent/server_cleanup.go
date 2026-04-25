package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// HandleServerCleanupCommand removes stale Docker resources on this server.
func HandleServerCleanupCommand(ctx context.Context, cmd *agentv1.ServerCleanupCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	var output strings.Builder
	success := true
	errMsg := ""

	run := func(title string, args ...string) {
		if !success {
			return
		}
		output.WriteString("==> ")
		output.WriteString(title)
		output.WriteString("\n")

		var stdout bytes.Buffer
		var stderr bytes.Buffer
		c := exec.CommandContext(ctx, "docker", args...)
		c.Stdout = &stdout
		c.Stderr = &stderr

		if err := c.Run(); err != nil {
			success = false
			errMsg = fmt.Sprintf("%s failed: %v", title, err)
			if stderr.Len() > 0 {
				errMsg += ": " + strings.TrimSpace(stderr.String())
			}
			output.WriteString(strings.TrimSpace(stdout.String()))
			if stdout.Len() > 0 {
				output.WriteString("\n")
			}
			output.WriteString(strings.TrimSpace(stderr.String()))
			output.WriteString("\n")
			return
		}

		text := strings.TrimSpace(stdout.String())
		if text == "" {
			text = "No resources removed."
		}
		output.WriteString(text)
		output.WriteString("\n\n")
	}

	withUntil := func(args []string) []string {
		if cmd.OlderThanHours <= 0 {
			return args
		}
		return append(args, "--filter", fmt.Sprintf("until=%dh", cmd.OlderThanHours))
	}

	if cmd.RemoveStoppedContainers {
		run("Stopped containers", withUntil([]string{"container", "prune", "-f"})...)
	}
	if cmd.RemoveUnusedImages {
		run("Unused images", withUntil([]string{"image", "prune", "-a", "-f"})...)
	}
	if cmd.RemoveUnusedNetworks {
		run("Unused networks", withUntil([]string{"network", "prune", "-f"})...)
	}
	if cmd.RemoveBuildCache {
		run("Build cache", withUntil([]string{"builder", "prune", "-f"})...)
	}
	if cmd.RemoveVolumes {
		run("Unused volumes", "volume", "prune", "-f")
	}

	if output.Len() == 0 {
		success = false
		errMsg = "no cleanup options selected"
	}

	logger.Info("server cleanup completed", "request_id", cmd.RequestId, "success", success)
	_ = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ServerCleanupResult{
			ServerCleanupResult: &agentv1.ServerCleanupResult{
				RequestId: cmd.RequestId,
				Success:   success,
				Output:    strings.TrimSpace(output.String()),
				Error:     errMsg,
			},
		},
	})
}
