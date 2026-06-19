package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// envFlagArgs returns repeated `<flag> KEY=VALUE` pairs for each build arg,
// sorted by key for deterministic command lines. Used to pass build-time env
// to the builders that read it via an env flag (nixpacks/pack/railpack).
func envFlagArgs(flag string, env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	args := make([]string, 0, len(env)*2)
	for _, k := range keys {
		args = append(args, flag, fmt.Sprintf("%s=%s", k, env[k]))
	}
	return args
}

const buildBaseDir = "/var/nixway/builds"

// HandleBuildCommand clones a repo, detects the builder, builds an OCI image, and streams output.
func HandleBuildCommand(ctx context.Context, cmd *agentv1.BuildCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	buildDir := filepath.Join(buildBaseDir, cmd.BuildId)
	os.MkdirAll(buildDir, 0755)

	sendOutput := func(phase string, output string, finished, success bool, errMsg, imageID string) {
		stream.Send(&agentv1.AgentMessage{
			Payload: &agentv1.AgentMessage_BuildOutput{
				BuildOutput: &agentv1.BuildOutput{
					BuildId:  cmd.BuildId,
					Output:   []byte(output),
					Phase:    phase,
					Finished: finished,
					Success:  success,
					Error:    errMsg,
					ImageId:  imageID,
				},
			},
		})
	}

	// Phase 1: Clone
	sendOutput("cloning", "Cloning repository...\n", false, false, "", "")

	repoURL := cmd.RepoUrl
	if cmd.AuthToken != "" {
		// Inject token for HTTPS clone: https://x-access-token:TOKEN@github.com/owner/repo.git
		repoURL = strings.Replace(repoURL, "https://", fmt.Sprintf("https://x-access-token:%s@", cmd.AuthToken), 1)
	}

	cloneArgs := []string{"clone", "--depth", "1"}
	if cmd.Branch != "" {
		cloneArgs = append(cloneArgs, "--branch", cmd.Branch)
	}
	cloneArgs = append(cloneArgs, repoURL, buildDir)

	cloneOut, err := runCommandStreaming(ctx, "git", cloneArgs, "", sendOutput, "cloning")
	if err != nil {
		sendOutput("cloning", cloneOut, true, false, fmt.Sprintf("clone failed: %v", err), "")
		cleanup(buildDir)
		return
	}
	if cmd.CommitSha != "" {
		sendOutput("cloning", fmt.Sprintf("Checking out commit %s...\n", cmd.CommitSha), false, false, "", "")
		fetchOut, fetchErr := runCommandStreaming(ctx, "git", []string{"fetch", "--depth", "1", "origin", cmd.CommitSha}, buildDir, sendOutput, "cloning")
		if fetchErr != nil {
			sendOutput("cloning", fetchOut+fmt.Sprintf("Warning: fetch commit failed: %v\n", fetchErr), false, false, "", "")
		}
		checkoutOut, checkoutErr := runCommandStreaming(ctx, "git", []string{"checkout", "--detach", cmd.CommitSha}, buildDir, sendOutput, "cloning")
		if checkoutErr != nil {
			sendOutput("cloning", checkoutOut, true, false, fmt.Sprintf("checkout commit failed: %v", checkoutErr), "")
			cleanup(buildDir)
			return
		}
	}

	// Determine working directory (support monorepo root_path)
	workDir := buildDir
	if cmd.RootPath != "" && cmd.RootPath != "/" {
		workDir = filepath.Join(buildDir, strings.TrimPrefix(cmd.RootPath, "/"))
	}

	// Phase 2: Auto-detect builder if needed
	builder := cmd.Builder
	if builder == "auto" {
		builder = detectBuilder(workDir, cmd.DockerfilePath)
		sendOutput("detecting", fmt.Sprintf("Auto-detected builder: %s\n", builder), false, false, "", "")
	}

	// Phase 3: Build
	sendOutput("building", fmt.Sprintf("Building with %s...\n", builder), false, false, "", "")

	var buildCmd *exec.Cmd
	switch builder {
	case "dockerfile":
		dockerfilePath := cmd.DockerfilePath
		if dockerfilePath == "" {
			dockerfilePath = "Dockerfile"
		}
		args := []string{"build", "-t", cmd.ImageTag, "-f", dockerfilePath}
		// Docker consumes build-time env via --build-arg (the Dockerfile must
		// declare a matching ARG to use it).
		args = append(args, envFlagArgs("--build-arg", cmd.BuildArgs)...)
		args = append(args, ".")
		buildCmd = exec.CommandContext(ctx, "docker", args...)
	case "nixpacks":
		args := []string{"build", ".", "--name", cmd.ImageTag}
		args = append(args, envFlagArgs("--env", cmd.BuildArgs)...)
		buildCmd = exec.CommandContext(ctx, "nixpacks", args...)
	case "buildpacks":
		args := []string{"build", cmd.ImageTag, "--builder", "heroku/builder:24"}
		args = append(args, envFlagArgs("--env", cmd.BuildArgs)...)
		buildCmd = exec.CommandContext(ctx, "pack", args...)
	case "railpack":
		args := []string{"build", "--tag", cmd.ImageTag}
		args = append(args, envFlagArgs("--env", cmd.BuildArgs)...)
		buildCmd = exec.CommandContext(ctx, "railpack", args...)
	default:
		// Fallback to nixpacks
		args := []string{"build", ".", "--name", cmd.ImageTag}
		args = append(args, envFlagArgs("--env", cmd.BuildArgs)...)
		buildCmd = exec.CommandContext(ctx, "nixpacks", args...)
	}
	buildCmd.Dir = workDir

	buildOut, err := runCommandStreamingExec(ctx, buildCmd, sendOutput, "building")
	if err != nil {
		sendOutput("building", buildOut, true, false, fmt.Sprintf("build failed: %v", err), "")
		cleanup(buildDir)
		return
	}

	// Phase 4: Push to registry. Without this, the image only exists on the
	// build host and any deploy that lands on a different agent fails to pull.
	if cmd.Registry != nil && cmd.Registry.Server != "" {
		if err := pushImage(ctx, cmd.Registry, cmd.ImageTag, sendOutput); err != nil {
			sendOutput("pushing", "", true, false, fmt.Sprintf("push failed: %v", err), "")
			cleanup(buildDir)
			return
		}
	}

	sendOutput("building", "Build completed successfully.\n", true, true, "", cmd.ImageTag)
	cleanup(buildDir)
}

// pushImage logs in, pushes the image, and logs out. Streams output as the
// "pushing" phase so build logs show progress in real time.
func pushImage(ctx context.Context, auth *agentv1.RegistryAuth, imageTag string, send outputFn) error {
	send("pushing", fmt.Sprintf("Logging in to %s...\n", auth.Server), false, false, "", "")

	loginCmd := exec.CommandContext(ctx, "docker", "login", "-u", auth.Username, "--password-stdin", auth.Server)
	loginCmd.Stdin = strings.NewReader(auth.Password)
	loginOut, err := loginCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker login: %s: %w", strings.TrimSpace(string(loginOut)), err)
	}

	send("pushing", fmt.Sprintf("Pushing %s...\n", imageTag), false, false, "", "")
	pushCmd := exec.CommandContext(ctx, "docker", "push", imageTag)
	if _, err := runCommandStreamingExec(ctx, pushCmd, send, "pushing"); err != nil {
		// Always logout on failure so creds don't linger.
		_ = exec.Command("docker", "logout", auth.Server).Run()
		return fmt.Errorf("docker push: %w", err)
	}

	if err := exec.Command("docker", "logout", auth.Server).Run(); err != nil {
		// Logout failure is non-fatal — image already pushed.
		send("pushing", fmt.Sprintf("Warning: docker logout failed: %v\n", err), false, false, "", "")
	}
	send("pushing", "Push completed.\n", false, false, "", "")
	return nil
}

// detectBuilder inspects the working directory to determine the best builder.
func detectBuilder(workDir, dockerfilePath string) string {
	if dockerfilePath == "" {
		dockerfilePath = "Dockerfile"
	}
	if fileExists(workDir, dockerfilePath) {
		return "dockerfile"
	}
	if fileExists(workDir, "nixpacks.toml") {
		return "nixpacks"
	}
	if fileExists(workDir, "Procfile") {
		return "buildpacks"
	}
	// Language detection fallback → nixpacks handles most languages
	return "nixpacks"
}

func fileExists(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}

func cleanup(dir string) {
	os.RemoveAll(dir)
}

type outputFn func(phase, output string, finished, success bool, errMsg, imageID string)

func runCommandStreaming(ctx context.Context, name string, args []string, dir string, send outputFn, phase string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	return runCommandStreamingExec(ctx, cmd, send, phase)
}

func runCommandStreamingExec(ctx context.Context, cmd *exec.Cmd, send outputFn, phase string) (string, error) {
	cmd.Stderr = nil // merge stderr into stdout via pipe
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	cmd.Stderr = cmd.Stdout // merge stderr to stdout

	if err := cmd.Start(); err != nil {
		return "", err
	}

	var output strings.Builder
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text() + "\n"
		output.WriteString(line)
		send(phase, line, false, false, "", "")
	}

	err = cmd.Wait()
	return output.String(), err
}
