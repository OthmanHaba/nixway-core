package integration

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAutoDiscovery verifies the auto-discovery endpoint detects project types.
func TestAutoDiscovery(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "discover@example.com", "password123", "Discover User")

	// Create a temp dir with a Dockerfile
	tmpDir := t.TempDir()
	err := os.WriteFile(filepath.Join(tmpDir, "Dockerfile"), []byte("FROM alpine\n"), 0644)
	require.NoError(t, err)

	// POST /api/v1/discover
	resp := env.Post("/api/v1/discover", map[string]string{
		"path": tmpDir,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var candidates []map[string]any
	ReadJSON(t, resp, &candidates)

	require.Len(t, candidates, 1)
	assert.Equal(t, "docker", candidates[0]["builder"])
	assert.Equal(t, 1.0, candidates[0]["confidence"])
}

// TestAutoDiscoveryMultiple verifies discovery with multiple project signals.
func TestAutoDiscoveryMultiple(t *testing.T) {
	env := SetupTestEnv(t)

	env.SignupAndLogin(env.Client, "discover2@example.com", "password123", "Discover User 2")

	tmpDir := t.TempDir()
	// Write both Dockerfile and package.json
	err := os.WriteFile(filepath.Join(tmpDir, "Dockerfile"), []byte("FROM node:18\n"), 0644)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(`{"name":"test"}`), 0644)
	require.NoError(t, err)

	resp := env.Post("/api/v1/discover", map[string]string{
		"path": tmpDir,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var candidates []map[string]any
	ReadJSON(t, resp, &candidates)

	// Should have docker (1.0) and nixpacks (0.7 for package.json)
	require.GreaterOrEqual(t, len(candidates), 2)

	builders := make(map[string]float64)
	for _, c := range candidates {
		builders[c["builder"].(string)] = c["confidence"].(float64)
	}
	assert.Equal(t, 1.0, builders["docker"])
	assert.Equal(t, 0.7, builders["nixpacks"])
}
