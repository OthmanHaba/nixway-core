package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// HandleRestartContainerCommand restarts a running container.
func HandleRestartContainerCommand(ctx context.Context, cmd *agentv1.RestartContainerCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	timeout := cmd.TimeoutSeconds
	if timeout == 0 {
		timeout = 10
	}

	out, err := exec.CommandContext(ctx, "docker", "restart", "-t", fmt.Sprintf("%d", timeout), cmd.ContainerName).CombinedOutput()

	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = fmt.Sprintf("restart failed: %s - %v", strings.TrimSpace(string(out)), err)
		logger.Warn("restart container failed", "name", cmd.ContainerName, "error", errMsg)
	} else {
		logger.Info("container restarted", "name", cmd.ContainerName)
	}

	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_RestartContainerResult{
			RestartContainerResult: &agentv1.RestartContainerResult{
				ContainerName: cmd.ContainerName,
				Success:       success,
				Error:         errMsg,
			},
		},
	})
}

// secretPatterns are env var key substrings that should be masked in inspect output.
var secretPatterns = []string{"SECRET", "PASSWORD", "TOKEN", "KEY", "API_KEY", "PRIVATE"}

func shouldMaskEnv(key string) bool {
	upper := strings.ToUpper(key)
	for _, p := range secretPatterns {
		if strings.Contains(upper, p) {
			return true
		}
	}
	return false
}

// HandleContainerInspectCommand inspects a container and returns its details.
func HandleContainerInspectCommand(ctx context.Context, cmd *agentv1.ContainerInspectCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	sendResult := func(result *agentv1.ContainerInspectResult) {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ContainerInspectResult{
				ContainerInspectResult: result,
			},
		})
	}

	// docker inspect
	out, err := exec.CommandContext(ctx, "docker", "inspect", cmd.ContainerName).Output()
	if err != nil {
		sendResult(&agentv1.ContainerInspectResult{
			RequestId:     cmd.RequestId,
			ContainerName: cmd.ContainerName,
			Success:       false,
			Error:         "inspect failed: " + err.Error(),
		})
		return
	}

	var inspects []struct {
		State struct {
			Status     string `json:"Status"`
			StartedAt  string `json:"StartedAt"`
			Pid        int64  `json:"Pid"`
			RestartCount int64 `json:"RestartCount"`
		} `json:"State"`
		Created string `json:"Created"`
		Config  struct {
			Image  string   `json:"Image"`
			Env    []string `json:"Env"`
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
		HostConfig struct {
			Memory   int64 `json:"Memory"`
			NanoCpus int64 `json:"NanoCpus"`
		} `json:"HostConfig"`
		NetworkSettings struct {
			Networks map[string]struct {
				IPAddress string `json:"IPAddress"`
			} `json:"Networks"`
			Ports json.RawMessage `json:"Ports"`
		} `json:"NetworkSettings"`
	}

	if err := json.Unmarshal(out, &inspects); err != nil || len(inspects) == 0 {
		sendResult(&agentv1.ContainerInspectResult{
			RequestId:     cmd.RequestId,
			ContainerName: cmd.ContainerName,
			Success:       false,
			Error:         "failed to parse inspect output",
		})
		return
	}

	info := inspects[0]

	// Parse env vars, mask secrets
	envMap := make(map[string]string)
	for _, e := range info.Config.Env {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			key, val := parts[0], parts[1]
			if shouldMaskEnv(key) {
				val = "SECRET_REF:" + key
			}
			envMap[key] = val
		}
	}

	// Get network IP (prefer nixway network)
	networkIP := ""
	for name, net := range info.NetworkSettings.Networks {
		networkIP = net.IPAddress
		if name == "nixway" {
			break
		}
	}

	// Parse ports
	var ports []string
	var portsMap map[string]interface{}
	if err := json.Unmarshal(info.NetworkSettings.Ports, &portsMap); err == nil {
		for port := range portsMap {
			ports = append(ports, port)
		}
	}

	// Get memory usage from docker stats (non-streaming)
	var memUsage int64
	var cpuPercent float64
	statsOut, err := exec.CommandContext(ctx, "docker", "stats", "--no-stream", "--format", "{{.MemUsage}}|{{.CPUPerc}}", cmd.ContainerName).Output()
	if err == nil {
		parts := strings.SplitN(strings.TrimSpace(string(statsOut)), "|", 2)
		if len(parts) == 2 {
			memUsage = parseMemUsage(parts[0])
			cpuStr := strings.TrimSuffix(strings.TrimSpace(parts[1]), "%")
			cpuPercent, _ = strconv.ParseFloat(cpuStr, 64)
		}
	}

	sendResult(&agentv1.ContainerInspectResult{
		RequestId:     cmd.RequestId,
		ContainerName: cmd.ContainerName,
		Status:        info.State.Status,
		Image:         info.Config.Image,
		CreatedAt:     info.Created,
		StartedAt:     info.State.StartedAt,
		MemoryLimit:   info.HostConfig.Memory,
		MemoryUsage:   memUsage,
		CpuPercent:    cpuPercent,
		Pid:           info.State.Pid,
		Env:           envMap,
		Labels:        info.Config.Labels,
		Ports:         ports,
		NetworkIp:     networkIP,
		RestartCount:  info.State.RestartCount,
		Success:       true,
	})
}

// parseMemUsage parses docker stats memory usage like "45.2MiB / 1.94GiB"
func parseMemUsage(s string) int64 {
	parts := strings.SplitN(strings.TrimSpace(s), "/", 2)
	if len(parts) == 0 {
		return 0
	}
	return parseBytes(strings.TrimSpace(parts[0]))
}

func parseBytes(s string) int64 {
	s = strings.TrimSpace(s)
	multiplier := int64(1)
	switch {
	case strings.HasSuffix(s, "GiB"):
		multiplier = 1024 * 1024 * 1024
		s = strings.TrimSuffix(s, "GiB")
	case strings.HasSuffix(s, "MiB"):
		multiplier = 1024 * 1024
		s = strings.TrimSuffix(s, "MiB")
	case strings.HasSuffix(s, "KiB"):
		multiplier = 1024
		s = strings.TrimSuffix(s, "KiB")
	case strings.HasSuffix(s, "B"):
		s = strings.TrimSuffix(s, "B")
	}
	val, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return int64(val * float64(multiplier))
}
