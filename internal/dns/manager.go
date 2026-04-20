package dns

import (
	"embed"
	"log/slog"
)

//go:embed scripts/*.sh
var scripts embed.FS

// GetCoreDNSScript returns the CoreDNS deployment script.
func GetCoreDNSScript() ([]byte, error) {
	return scripts.ReadFile("scripts/coredns.sh")
}

// Manager coordinates DNS updates across cluster members.
type Manager struct {
	logger *slog.Logger
}

// NewManager creates a new DNS manager.
func NewManager(logger *slog.Logger) *Manager {
	return &Manager{logger: logger}
}
