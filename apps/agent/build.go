package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

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
		for k, v := range cmd.BuildArgs {
			args = append(args, "--build-arg", fmt.Sprintf("%s=%s", k, v))
		}
		args = append(args, ".")
		buildCmd = exec.CommandContext(ctx, "docker", args...)
	case "nixpacks":
		buildCmd = exec.CommandContext(ctx, "nixpacks", "build", ".", "--name", cmd.ImageTag)
	case "buildpacks":
		buildCmd = exec.CommandContext(ctx, "pack", "build", cmd.ImageTag, "--builder", "heroku/builder:24")
	case "railpack":
		buildCmd = exec.CommandContext(ctx, "railpack", "build", "--tag", cmd.ImageTag)
	default:
		// Fallback to nixpacks
		buildCmd = exec.CommandContext(ctx, "nixpacks", "build", ".", "--name", cmd.ImageTag)
	}
	buildCmd.Dir = workDir

	buildOut, err := runCommandStreamingExec(ctx, buildCmd, sendOutput, "building")
	if err != nil {
		sendOutput("building", buildOut, true, false, fmt.Sprintf("build failed: %v", err), "")
		cleanup(buildDir)
		return
	}

	// Get image ID
	imageID, _ := exec.CommandContext(ctx, "docker", "inspect", "--format", "{{.Id}}", cmd.ImageTag).Output()

	sendOutput("building", "Build completed successfully.\n", true, true, "", strings.TrimSpace(string(imageID)))
	cleanup(buildDir)
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
