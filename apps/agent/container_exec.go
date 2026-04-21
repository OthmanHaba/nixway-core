package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"sync"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

type execSession struct {
	stdin  io.WriteCloser
	cancel context.CancelFunc
	cmd    *exec.Cmd
}

var (
	execSessions   sync.Map // map[sessionID]*execSession
)

// HandleContainerExecCommand opens a docker exec session with TTY.
func HandleContainerExecCommand(ctx context.Context, cmd *agentv1.ContainerExecCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	sessionCtx, cancel := context.WithCancel(ctx)

	shell := cmd.Command
	if shell == "" {
		shell = "/bin/sh"
	}

	cols := cmd.Cols
	if cols == 0 {
		cols = 120
	}
	rows := cmd.Rows
	if rows == 0 {
		rows = 40
	}

	sendOutput := func(data []byte, finished bool, exitCode int32, errMsg string) {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ContainerExecOutput{
				ContainerExecOutput: &agentv1.ContainerExecOutput{
					SessionId: cmd.SessionId,
					Data:      data,
					Finished:  finished,
					ExitCode:  exitCode,
					Error:     errMsg,
				},
			},
		})
	}

	// Start docker exec with TTY
	execCmd := exec.CommandContext(sessionCtx, "docker", "exec", "-it",
		"-e", fmt.Sprintf("COLUMNS=%d", cols),
		"-e", fmt.Sprintf("LINES=%d", rows),
		cmd.ContainerName, shell)

	stdin, err := execCmd.StdinPipe()
	if err != nil {
		sendOutput(nil, true, 1, "failed to create stdin pipe: "+err.Error())
		cancel()
		return
	}

	stdout, err := execCmd.StdoutPipe()
	if err != nil {
		sendOutput(nil, true, 1, "failed to create stdout pipe: "+err.Error())
		cancel()
		return
	}
	execCmd.Stderr = execCmd.Stdout // merge stderr into stdout

	if err := execCmd.Start(); err != nil {
		sendOutput(nil, true, 1, "failed to start exec: "+err.Error())
		cancel()
		return
	}

	session := &execSession{
		stdin:  stdin,
		cancel: cancel,
		cmd:    execCmd,
	}
	execSessions.Store(cmd.SessionId, session)

	logger.Info("exec session started", "session_id", cmd.SessionId, "container", cmd.ContainerName)

	// Read stdout and send to control plane
	buf := make([]byte, 4096)
	for {
		n, err := stdout.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			sendOutput(data, false, 0, "")
		}
		if err != nil {
			break
		}
	}

	exitCode := int32(0)
	if err := execCmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = int32(exitErr.ExitCode())
		}
	}

	execSessions.Delete(cmd.SessionId)
	cancel()
	sendOutput(nil, true, exitCode, "")
	logger.Info("exec session ended", "session_id", cmd.SessionId, "exit_code", exitCode)
}

// RouteExecInput dispatches stdin data to an active exec session.
func RouteExecInput(input *agentv1.ContainerExecInput, logger *slog.Logger) {
	val, ok := execSessions.Load(input.SessionId)
	if !ok {
		logger.Warn("exec input for unknown session", "session_id", input.SessionId)
		return
	}
	session := val.(*execSession)

	if input.Close {
		session.stdin.Close()
		session.cancel()
		return
	}

	if len(input.Data) > 0 {
		session.stdin.Write(input.Data)
	}

	// Resize: docker exec doesn't support resize easily without Docker API,
	// but we can send a SIGWINCH-like approach. For simplicity, resize is
	// handled by the initial COLUMNS/LINES env vars. Full PTY resize would
	// require using the Docker SDK's ContainerExecResize API.
}
