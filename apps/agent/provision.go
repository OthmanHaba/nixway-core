package main

import (
	"bufio"
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// HandleProvisionCommand executes a provisioning script and streams output back.
func HandleProvisionCommand(ctx context.Context, cmd *agentv1.ProvisionCommand, stream agentv1.AgentService_ConnectClient) {
	sendOutput := func(output []byte, finished, success bool, errMsg string) {
		_ = stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ProvisionOutput{
				ProvisionOutput: &agentv1.ProvisionOutput{
					JobId:     cmd.JobId,
					Component: cmd.Component,
					Output:    output,
					Finished:  finished,
					Success:   success,
					Error:     errMsg,
				},
			},
		})
	}

	// Write script to temp file.
	tmpFile, err := os.CreateTemp("", "nixway-provision-*.sh")
	if err != nil {
		sendOutput(nil, true, false, err.Error())
		return
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(cmd.Script); err != nil {
		sendOutput(nil, true, false, err.Error())
		return
	}
	tmpFile.Close()

	if err := os.Chmod(tmpFile.Name(), 0755); err != nil {
		sendOutput(nil, true, false, err.Error())
		return
	}

	// Execute script.
	command := exec.CommandContext(ctx, "bash", tmpFile.Name())
	stdout, err := command.StdoutPipe()
	if err != nil {
		sendOutput(nil, true, false, err.Error())
		return
	}
	command.Stderr = command.Stdout // merge stderr into stdout

	if err := command.Start(); err != nil {
		sendOutput(nil, true, false, err.Error())
		return
	}

	// Stream output line by line.
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Bytes()
		sendOutput(append(append([]byte(nil), line...), '\n'), false, false, "")
	}

	// Wait for completion.
	err = command.Wait()
	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	sendOutput(nil, true, success, errMsg)
}

// HandleSSHKeyInstall adds or removes an SSH public key from ~/.ssh/authorized_keys.
func HandleSSHKeyInstall(ctx context.Context, cmd *agentv1.SSHKeyInstallCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	sendResult := func(success bool, errMsg string) {
		_ = stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_SshKeyResult{
				SshKeyResult: &agentv1.SSHKeyInstallResult{
					Success: success,
					Error:   errMsg,
				},
			},
		})
	}

	home, err := os.UserHomeDir()
	if err != nil {
		sendResult(false, "failed to get home dir: "+err.Error())
		return
	}

	sshDir := home + "/.ssh"
	if err := os.MkdirAll(sshDir, 0700); err != nil {
		sendResult(false, "failed to create .ssh dir: "+err.Error())
		return
	}

	authKeysPath := sshDir + "/authorized_keys"

	switch strings.ToLower(cmd.Action) {
	case "add":
		f, err := os.OpenFile(authKeysPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			sendResult(false, "failed to open authorized_keys: "+err.Error())
			return
		}
		defer f.Close()
		key := strings.TrimSpace(cmd.PublicKey) + "\n"
		if _, err := f.WriteString(key); err != nil {
			sendResult(false, "failed to write key: "+err.Error())
			return
		}
		logger.Info("ssh key added")
		sendResult(true, "")

	case "remove":
		data, err := os.ReadFile(authKeysPath)
		if err != nil {
			if os.IsNotExist(err) {
				sendResult(true, "") // nothing to remove
				return
			}
			sendResult(false, "failed to read authorized_keys: "+err.Error())
			return
		}
		target := strings.TrimSpace(cmd.PublicKey)
		var kept []string
		for _, line := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(line) != target {
				kept = append(kept, line)
			}
		}
		if err := os.WriteFile(authKeysPath, []byte(strings.Join(kept, "\n")), 0600); err != nil {
			sendResult(false, "failed to write authorized_keys: "+err.Error())
			return
		}
		logger.Info("ssh key removed")
		sendResult(true, "")

	default:
		sendResult(false, "unknown action: "+cmd.Action)
	}
}
