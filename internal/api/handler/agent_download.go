package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
)

// AgentDownloadHandler serves pre-built agent binaries for remote servers.
type AgentDownloadHandler struct {
	binaryDir string // directory containing agent-linux-amd64, agent-linux-arm64
	logger    *slog.Logger
}

func NewAgentDownloadHandler(binaryDir string, logger *slog.Logger) *AgentDownloadHandler {
	dir := binaryDir
	// If it's a relative path and doesn't exist from cwd, try resolving from project root
	if !filepath.IsAbs(dir) {
		if _, err := os.Stat(dir); err != nil {
			// Try common relative paths (running from apps/api/, apps/worker/, etc.)
			for _, prefix := range []string{"../../", "../"} {
				candidate := filepath.Join(prefix, dir)
				if _, err := os.Stat(candidate); err == nil {
					dir = candidate
					break
				}
			}
			// Also try NIXWAY_ROOT
			if root := os.Getenv("NIXWAY_ROOT"); root != "" {
				candidate := filepath.Join(root, binaryDir)
				if _, err := os.Stat(candidate); err == nil {
					dir = candidate
				}
			}
		}
	}
	// Resolve to absolute for reliable serving
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	logger.Info("agent binary directory", "path", dir, "original", binaryDir, "exists", dirExists(dir))
	return &AgentDownloadHandler{
		binaryDir: dir,
		logger:    logger,
	}
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}


// Download serves the agent binary for the requested architecture.
// GET /agent/download/{arch}
func (h *AgentDownloadHandler) Download(w http.ResponseWriter, r *http.Request) {
	arch := r.PathValue("arch")
	if arch != "amd64" && arch != "arm64" {
		http.Error(w, "unsupported architecture: must be amd64 or arm64", http.StatusBadRequest)
		return
	}

	filename := fmt.Sprintf("agent-linux-%s", arch)
	filePath := filepath.Join(h.binaryDir, filename)

	info, err := os.Stat(filePath)
	if err != nil {
		h.logger.Warn("agent binary not found — run: cd apps/agent && make build",
			"path", filePath,
			"arch", arch,
		)
		http.Error(w, fmt.Sprintf("agent binary not found for %s — build it first with: cd apps/agent && CGO_ENABLED=0 GOOS=linux GOARCH=%s go build -ldflags='-s -w' -o bin/agent-linux-%s .", arch, arch, arch), http.StatusNotFound)
		return
	}

	h.logger.Info("serving agent binary", "arch", arch, "size", info.Size())

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=nixway-agent")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))

	http.ServeFile(w, r, filePath)
}
