package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

const traefikDynamicDir = "/etc/traefik/dynamic"

// HandleDeployCommand starts a container, writes Traefik config, and performs health checks.
func HandleDeployCommand(ctx context.Context, cmd *agentv1.DeployCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	sendOutput := func(phase, containerID string, finished, success bool, errMsg string) {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_DeployOutput{
				DeployOutput: &agentv1.DeployOutput{
					DeployId:    cmd.DeployId,
					TargetId:    cmd.TargetId,
					Phase:       phase,
					ContainerId: containerID,
					Finished:    finished,
					Success:     success,
					Error:       errMsg,
				},
			},
		})
	}

	// Phase 1: Ensure nixway network exists and Traefik is connected
	sendOutput("starting", "", false, false, "")
	ensureNetwork(ctx)

	// Build docker run args — on nixway network, Traefik routes via Docker provider
	args := []string{
		"run", "-d",
		"--name", cmd.ContainerName,
		"--network", "nixway",
		"--restart", "unless-stopped",
	}

	// Add Traefik labels for automatic routing
	if cmd.Traefik != nil {
		args = append(args,
			"-l", "traefik.enable=true",
			"-l", fmt.Sprintf("traefik.http.routers.%s.entrypoints=web", cmd.Traefik.AppSlug),
			"-l", fmt.Sprintf("traefik.http.services.%s.loadbalancer.server.port=%d", cmd.Traefik.AppSlug, cmd.Port),
		)

		// Build host rule from domains
		var rules []string
		for _, domain := range cmd.Traefik.Domains {
			rules = append(rules, fmt.Sprintf("Host(`%s`)", domain))
		}
		if len(rules) > 0 {
			args = append(args, "-l", fmt.Sprintf("traefik.http.routers.%s.rule=%s", cmd.Traefik.AppSlug, strings.Join(rules, " || ")))
		}

		if cmd.Traefik.Tls {
			args = append(args, "-l", fmt.Sprintf("traefik.http.routers.%s.tls.certresolver=letsencrypt", cmd.Traefik.AppSlug))
		}

		// Also write file-provider config for dynamic domain updates
		writeTraefikConfig(cmd.Traefik, cmd.Port, cmd.ContainerName)
	}

	// Add environment variables
	for k, v := range cmd.Env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	// Always set PORT env var
	args = append(args, "-e", fmt.Sprintf("PORT=%d", cmd.Port))

	args = append(args, cmd.ImageTag)

	out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil {
		sendOutput("failed", "", true, false, fmt.Sprintf("docker run failed: %s - %v", string(out), err))
		return
	}

	containerID := strings.TrimSpace(string(out))
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	// Phase 2: Health check (Traefik routing handled via Docker labels + file provider)
	sendOutput("health_checking", containerID, false, false, "")

	interval := time.Duration(cmd.HealthCheckIntervalSeconds) * time.Second
	if interval == 0 {
		interval = 5 * time.Second
	}
	timeout := time.Duration(cmd.HealthCheckTimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 60 * time.Second
	}

	deadline := time.Now().Add(timeout)

	// Get container IP on nixway network for health check
	var containerIP string
	for i := 0; i < 5; i++ {
		ipOut, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.NetworkSettings.Networks.nixway.IPAddress}}", cmd.ContainerName).Output()
		if err == nil {
			containerIP = strings.TrimSpace(string(ipOut))
			if containerIP != "" {
				break
			}
		}
		time.Sleep(1 * time.Second)
	}
	if containerIP == "" {
		sendOutput("failed", containerID, true, false, "could not determine container IP")
		return
	}

	healthURL := fmt.Sprintf("http://%s:%d%s", containerIP, cmd.Port, cmd.HealthCheckPath)

	for time.Now().Before(deadline) {
		// Check container is still running
		inspectOut, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", cmd.ContainerName).Output()
		if err != nil || strings.TrimSpace(string(inspectOut)) != "true" {
			logs, _ := exec.CommandContext(ctx, "docker", "logs", "--tail", "50", cmd.ContainerName).CombinedOutput()
			sendOutput("failed", containerID, true, false, fmt.Sprintf("container exited unexpectedly. Logs:\n%s", string(logs)))
			return
		}

		// HTTP health check
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(healthURL)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 400 {
				sendOutput("healthy", containerID, true, true, "")
				return
			}
		}

		time.Sleep(interval)
	}

	// Timeout — report unhealthy
	sendOutput("failed", containerID, true, false, "health check timed out")
}

// ensureNetwork creates the nixway Docker network if it doesn't exist and connects Traefik to it.
func ensureNetwork(ctx context.Context) {
	// Create network (ignore error if already exists)
	exec.CommandContext(ctx, "docker", "network", "create", "nixway").Run()

	// Connect Traefik to the network (ignore error if already connected)
	exec.CommandContext(ctx, "docker", "network", "connect", "nixway", "traefik").Run()
}

// writeTraefikConfig writes a Traefik dynamic config YAML for the app (file provider).
// containerName is used to route via the Docker network (Traefik resolves container names on shared network).
func writeTraefikConfig(cfg *agentv1.TraefikConfig, port int32, containerName ...string) {
	os.MkdirAll(traefikDynamicDir, 0755)

	// Build Host rules
	var rules []string
	for _, domain := range cfg.Domains {
		rules = append(rules, fmt.Sprintf("Host(`%s`)", domain))
	}
	hostRule := strings.Join(rules, " || ")

	entryPoints := "web"
	tlsConfig := ""
	if cfg.Tls {
		entryPoints = "websecure"
		tlsConfig = `      tls:
        certResolver: letsencrypt`
	}

	// Use container name as hostname (Docker DNS on nixway network)
	target := "localhost"
	if len(containerName) > 0 && containerName[0] != "" {
		target = containerName[0]
	}

	yaml := fmt.Sprintf(`http:
  routers:
    %s:
      rule: "%s"
      entryPoints:
        - %s
%s
      service: %s
  services:
    %s:
      loadBalancer:
        servers:
          - url: "http://%s:%d"
`, cfg.AppSlug, hostRule, entryPoints, tlsConfig, cfg.AppSlug, cfg.AppSlug, target, port)

	configPath := filepath.Join(traefikDynamicDir, cfg.AppSlug+".yml")
	os.WriteFile(configPath, []byte(yaml), 0644)
}

// HandleContainerLogsCommand streams container logs back to the control plane.
func HandleContainerLogsCommand(ctx context.Context, cmd *agentv1.ContainerLogsCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	tail := fmt.Sprintf("%d", cmd.Tail)
	if cmd.Tail <= 0 {
		tail = "100"
	}

	args := []string{"logs", "--tail", tail}
	if cmd.Follow {
		args = append(args, "-f")
	}
	args = append(args, cmd.ContainerName)

	logCmd := exec.CommandContext(ctx, "docker", args...)
	stdout, err := logCmd.StdoutPipe()
	if err != nil {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ContainerLogsOutput{
				ContainerLogsOutput: &agentv1.ContainerLogsOutput{
					RequestId: cmd.RequestId,
					Finished:  true,
					Error:     err.Error(),
				},
			},
		})
		return
	}
	logCmd.Stderr = logCmd.Stdout

	if err := logCmd.Start(); err != nil {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ContainerLogsOutput{
				ContainerLogsOutput: &agentv1.ContainerLogsOutput{
					RequestId: cmd.RequestId,
					Finished:  true,
					Error:     err.Error(),
				},
			},
		})
		return
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_ContainerLogsOutput{
				ContainerLogsOutput: &agentv1.ContainerLogsOutput{
					RequestId: cmd.RequestId,
					Output:    []byte(scanner.Text() + "\n"),
				},
			},
		})
	}

	logCmd.Wait()
	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ContainerLogsOutput{
			ContainerLogsOutput: &agentv1.ContainerLogsOutput{
				RequestId: cmd.RequestId,
				Finished:  true,
			},
		},
	})
}

// HandleStopContainerCommand stops and removes a container.
func HandleStopContainerCommand(ctx context.Context, cmd *agentv1.StopContainerCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	timeout := cmd.TimeoutSeconds
	if timeout == 0 {
		timeout = 10
	}

	// Stop
	out, err := exec.CommandContext(ctx, "docker", "stop", "-t", fmt.Sprintf("%d", timeout), cmd.ContainerName).CombinedOutput()
	if err != nil {
		logger.Warn("stop container failed", "name", cmd.ContainerName, "output", string(out), "error", err)
	}

	// Remove
	exec.CommandContext(ctx, "docker", "rm", "-f", cmd.ContainerName).Run()

	// Remove Traefik config if requested
	if cmd.RemoveTraefik && cmd.AppSlug != "" {
		os.Remove(filepath.Join(traefikDynamicDir, cmd.AppSlug+".yml"))
	}

	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_StopContainerResult{
			StopContainerResult: &agentv1.StopContainerResult{
				ContainerName: cmd.ContainerName,
				Success:       true,
			},
		},
	})
}

// HandleImagePullCommand pulls an image from another server over the WireGuard mesh.
func HandleImagePullCommand(ctx context.Context, cmd *agentv1.ImagePullCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	// Transfer via: ssh source_server "docker save image_tag" | docker load
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no %s 'docker save %s | gzip' | gunzip | docker load",
		cmd.SourceServerIp, cmd.ImageTag)

	out, err := exec.CommandContext(ctx, "bash", "-c", sshCmd).CombinedOutput()

	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = fmt.Sprintf("image pull failed: %s - %v", string(out), err)
		logger.Warn("image pull failed", "tag", cmd.ImageTag, "source", cmd.SourceServerIp, "error", err)
	}

	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ImagePullResult{
			ImagePullResult: &agentv1.ImagePullResult{
				TransferId: cmd.TransferId,
				Success:    success,
				Error:      errMsg,
			},
		},
	})
}
