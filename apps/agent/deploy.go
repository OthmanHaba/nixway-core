package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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

	// Build docker run args. Traefik is enabled only after the container passes
	// health checks, so unhealthy replicas never enter the backend pool.
	args := []string{
		"run", "-d",
		"--name", cmd.ContainerName,
		"--network", "nixway",
		"--restart", "unless-stopped",
		"-l", "traefik.enable=false",
	}
	for k, v := range cmd.Labels {
		args = append(args, "-l", fmt.Sprintf("%s=%s", k, v))
	}

	// Edge-mode signal: when the control plane has scheduled this replica on
	// a cluster that runs a dedicated edge LB, it ships two labels telling
	// us to expose the container on the worker's WireGuard IP at a specific
	// host port. The edge Traefik then reaches us at http://<wg>:<host>.
	// When labels are absent we keep the legacy node-local Traefik flow.
	edgeHostPort := cmd.Labels["nixway.host_port"]
	edgeBindAddr := cmd.Labels["nixway.bind_address"]
	edgeMode := edgeHostPort != "" && edgeBindAddr != "" && cmd.Port > 0
	if edgeMode {
		args = append(args, "-p", fmt.Sprintf("%s:%s:%d", edgeBindAddr, edgeHostPort, cmd.Port))
	}

	// Add environment variables
	for k, v := range cmd.Env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	// Always set PORT env var
	args = append(args, "-e", fmt.Sprintf("PORT=%d", cmd.Port))

	// Resource limits
	if cmd.MemoryLimitMb > 0 {
		args = append(args, "--memory", fmt.Sprintf("%dm", cmd.MemoryLimitMb))
	}
	if cmd.CpuLimitMillicores > 0 {
		cpus := float64(cmd.CpuLimitMillicores) / 1000.0
		args = append(args, "--cpus", fmt.Sprintf("%.2f", cpus))
	}

	// Volume bind mounts (for stateful workloads like databases). The host_path
	// is created on demand to avoid Docker creating an empty directory owned by
	// root that the container then can't initialize.
	for _, mount := range cmd.VolumeMounts {
		if mount == nil || mount.HostPath == "" || mount.ContainerPath == "" {
			continue
		}
		_ = os.MkdirAll(mount.HostPath, 0o755)
		spec := fmt.Sprintf("%s:%s", mount.HostPath, mount.ContainerPath)
		if mount.ReadOnly {
			spec += ":ro"
		}
		args = append(args, "-v", spec)
	}

	// Pull the image up-front so registry/auth failures surface a clean
	// error instead of getting buried inside `docker run` output. With
	// credentials we log in and out around the pull so the daemon's
	// config.json doesn't accumulate stale creds across deploys.
	if err := pullDeployImage(ctx, cmd.Registry, cmd.ImageTag); err != nil {
		sendOutput("failed", "", true, false, err.Error())
		return
	}

	// --pull never: image is already local from the explicit pull above.
	args = append(args, "--pull", "never", cmd.ImageTag)

	// Optional CMD override (e.g. `redis-server --requirepass $REDIS_PASSWORD`).
	if cmd.ContainerCommand != "" {
		args = append(args, "sh", "-c", cmd.ContainerCommand)
	}

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

	// Exec-based health check path (used by databases and other non-HTTP services).
	if cmd.ExecHealthCheck != nil && cmd.ExecHealthCheck.Command != "" {
		execInterval := time.Duration(cmd.ExecHealthCheck.IntervalSeconds) * time.Second
		if execInterval == 0 {
			execInterval = interval
		}
		for time.Now().Before(deadline) {
			inspectOut, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", cmd.ContainerName).Output()
			if err != nil || strings.TrimSpace(string(inspectOut)) != "true" {
				logs, _ := exec.CommandContext(ctx, "docker", "logs", "--tail", "50", cmd.ContainerName).CombinedOutput()
				sendOutput("failed", containerID, true, false, fmt.Sprintf("container exited unexpectedly. Logs:\n%s", string(logs)))
				return
			}
			if err := exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName, "sh", "-c", cmd.ExecHealthCheck.Command).Run(); err == nil {
				// Database containers ship as the engine's superuser; create
				// the application-scoped user before declaring healthy so
				// linked apps can connect on the very first deploy.
				if cmd.Labels["nixway.kind"] == "database" {
					sendOutput("post_init", containerID, false, false, "")
					if initErr := runDatabasePostInit(ctx, cmd, logger); initErr != nil {
						logs, _ := exec.CommandContext(ctx, "docker", "logs", "--tail", "50", cmd.ContainerName).CombinedOutput()
						sendOutput("failed", containerID, true, false, fmt.Sprintf("post-init failed: %v\n%s", initErr, string(logs)))
						return
					}
				}
				if !cmd.SkipTraefik && !edgeMode && cmd.Traefik != nil {
					writeTraefikConfig(cmd.Traefik, cmd.Port, cmd.ContainerName)
				}
				sendOutput("healthy", containerID, true, true, "")
				return
			}
			time.Sleep(execInterval)
		}
		sendOutput("failed", containerID, true, false, "exec health check timed out")
		return
	}

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

	// TCP health check: the app is "healthy" the moment its port accepts a
	// connection — that is exactly the condition Traefik needs to route to it.
	// We deliberately do NOT require an HTTP 2xx on a guessed path: stock images
	// (nginx, redis, postgres, …) serve fine but 404 on /healthz, and gating the
	// route on that left them unroutable (Traefik 404 with no router at all).
	healthAddr := net.JoinHostPort(containerIP, strconv.Itoa(int(cmd.Port)))

	for time.Now().Before(deadline) {
		// Check container is still running
		inspectOut, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", cmd.ContainerName).Output()
		if err != nil || strings.TrimSpace(string(inspectOut)) != "true" {
			logs, _ := exec.CommandContext(ctx, "docker", "logs", "--tail", "50", cmd.ContainerName).CombinedOutput()
			sendOutput("failed", containerID, true, false, fmt.Sprintf("container exited unexpectedly. Logs:\n%s", string(logs)))
			return
		}

		// TCP health check: does anything accept connections on the app port?
		conn, err := net.DialTimeout("tcp", healthAddr, 3*time.Second)
		if err == nil {
			conn.Close()
			if !cmd.SkipTraefik && !edgeMode && cmd.Traefik != nil {
				writeTraefikConfig(cmd.Traefik, cmd.Port, cmd.ContainerName)
			}
			sendOutput("healthy", containerID, true, true, "")
			return
		}

		time.Sleep(interval)
	}

	// Timeout — report unhealthy. Name the port so a port mismatch (the app
	// listens on a different port than configured) is diagnosable instead of a
	// silent downstream 404.
	logs, _ := exec.CommandContext(ctx, "docker", "logs", "--tail", "50", cmd.ContainerName).CombinedOutput()
	sendOutput("failed", containerID, true, false, fmt.Sprintf(
		"health check timed out: nothing accepted TCP on container port %d. Does the app listen on this port? Logs:\n%s",
		cmd.Port, string(logs)))
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

	// Use container name as hostname (Docker DNS on nixway network)
	target := "localhost"
	if len(containerName) > 0 && containerName[0] != "" {
		target = containerName[0]
	}

	// Publish on BOTH entrypoints so the app is reachable however traffic
	// arrives: plain HTTP on :80 (e.g. Cloudflare "Flexible") and HTTPS on :443
	// (e.g. Cloudflare "Full"). The websecure router uses `tls: {}` so Traefik
	// serves its built-in default cert — no ACME, no per-app cert, no rate
	// limits. Behind a proxy the origin cert is never user-visible; direct hits
	// just get a self-signed warning. Two routers (not one with both
	// entrypoints) because a router with `tls` set only answers on websecure.
	yaml := fmt.Sprintf(`http:
  routers:
    %[1]s:
      rule: "%[2]s"
      entryPoints:
        - web
      service: %[1]s
    %[1]s-tls:
      rule: "%[2]s"
      entryPoints:
        - websecure
      tls: {}
      service: %[1]s
  services:
    %[1]s:
      loadBalancer:
        servers:
          - url: "http://%[3]s:%[4]d"
`, cfg.AppSlug, hostRule, target, port)

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

	if cmd.RemoveTraefik && cmd.AppSlug != "" {
		os.Remove(filepath.Join(traefikDynamicDir, cmd.AppSlug+".yml"))
		drain := 30 * time.Second
		if timeout > 0 && timeout < 30 {
			drain = time.Duration(timeout) * time.Second
		}
		logger.Info("removed Traefik route, draining before stop", "app", cmd.AppSlug, "container", cmd.ContainerName, "drain", drain)
		time.Sleep(drain)
	}

	// Stop
	out, err := exec.CommandContext(ctx, "docker", "stop", "-t", fmt.Sprintf("%d", timeout), cmd.ContainerName).CombinedOutput()
	if err != nil {
		logger.Warn("stop container failed", "name", cmd.ContainerName, "output", string(out), "error", err)
	}

	// Remove
	exec.CommandContext(ctx, "docker", "rm", "-f", cmd.ContainerName).Run()

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

// pullDeployImage logs in (if creds were supplied), explicitly pulls the
// image, then logs out. A clean error from this step is far easier to act
// on than the same error wrapped in `docker run` output.
func pullDeployImage(ctx context.Context, auth *agentv1.RegistryAuth, imageTag string) error {
	if auth != nil && auth.Server != "" {
		loginCmd := exec.CommandContext(ctx, "docker", "login", "-u", auth.Username, "--password-stdin", auth.Server)
		loginCmd.Stdin = strings.NewReader(auth.Password)
		if out, err := loginCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("docker login %s: %s: %w", auth.Server, strings.TrimSpace(string(out)), err)
		}
		defer func() { _ = exec.Command("docker", "logout", auth.Server).Run() }()
	}

	pullOut, err := exec.CommandContext(ctx, "docker", "pull", imageTag).CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker pull %s: %s: %w", imageTag, strings.TrimSpace(string(pullOut)), err)
	}
	return nil
}
