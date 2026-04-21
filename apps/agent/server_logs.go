package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"os/exec"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// HandleServerLogsCommand streams journalctl output back to the control plane.
func HandleServerLogsCommand(ctx context.Context, cmd *agentv1.ServerLogsCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	sendOutput := func(output []byte, finished bool, errMsg string) {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ServerLogsOutput{
				ServerLogsOutput: &agentv1.ServerLogsOutput{
					RequestId: cmd.RequestId,
					Output:    output,
					Finished:  finished,
					Error:     errMsg,
				},
			},
		})
	}

	tail := cmd.Tail
	if tail <= 0 {
		tail = 100
	}

	args := []string{"--no-pager", "-o", "short-iso", "-n", fmt.Sprintf("%d", tail)}
	if cmd.Unit != "" {
		args = append(args, "-u", cmd.Unit)
	}
	if cmd.Follow {
		args = append(args, "-f")
	}

	logCmd := exec.CommandContext(ctx, "journalctl", args...)
	stdout, err := logCmd.StdoutPipe()
	if err != nil {
		sendOutput(nil, true, "failed to create pipe: "+err.Error())
		return
	}
	logCmd.Stderr = logCmd.Stdout

	if err := logCmd.Start(); err != nil {
		sendOutput(nil, true, "failed to start journalctl: "+err.Error())
		return
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		sendOutput([]byte(scanner.Text()+"\n"), false, "")
	}

	logCmd.Wait()
	sendOutput(nil, true, "")
}
