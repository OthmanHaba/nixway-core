package main

import (
	"bytes"
	"context"
	"log/slog"
	"os/exec"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// HandleExecCommand executes the command from the control plane and streams
// stdout/stderr back over the Connect stream.
func HandleExecCommand(
	ctx context.Context,
	cmd *agentv1.ExecCommand,
	stream agentv1.AgentService_ConnectClient,
	logger *slog.Logger,
) {
	logger.Info("executing command",
		"command_id", cmd.CommandId,
		"command", cmd.Command,
		"args", cmd.Args,
	)

	c := exec.CommandContext(ctx, cmd.Command, cmd.Args...) //nolint:gosec
	if cmd.WorkingDir != "" {
		c.Dir = cmd.WorkingDir
	}
	// Merge env map into the process environment.
	if len(cmd.Env) > 0 {
		envSlice := make([]string, 0, len(cmd.Env))
		for k, v := range cmd.Env {
			envSlice = append(envSlice, k+"="+v)
		}
		c.Env = envSlice
	}

	var stdout, stderr bytes.Buffer
	c.Stdout = &stdout
	c.Stderr = &stderr

	exitCode := int32(0)
	if err := c.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = int32(exitErr.ExitCode())
		} else {
			exitCode = 1
			stderr.WriteString(err.Error())
		}
	}

	out := &agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ExecOutput{
			ExecOutput: &agentv1.ExecOutput{
				CommandId: cmd.CommandId,
				Stdout:    stdout.Bytes(),
				Stderr:    stderr.Bytes(),
				Finished:  true,
				ExitCode:  exitCode,
			},
		},
	}

	if err := stream.Send(out); err != nil {
		logger.Warn("failed to send exec output", "command_id", cmd.CommandId, "err", err)
	}
}
