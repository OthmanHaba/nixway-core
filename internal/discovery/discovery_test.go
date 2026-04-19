package discovery

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mkTempDir(t *testing.T, files ...string) string {
	t.Helper()
	dir := t.TempDir()
	for _, f := range files {
		err := os.WriteFile(filepath.Join(dir, f), []byte{}, 0644)
		require.NoError(t, err)
	}
	return dir
}

func TestDiscover_Dockerfile(t *testing.T) {
	dir := mkTempDir(t, "Dockerfile")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.NotEmpty(t, candidates)
	assert.Equal(t, "docker", candidates[0].Builder)
	assert.Equal(t, 1.0, candidates[0].Confidence)
}

func TestDiscover_NixpacksToml(t *testing.T) {
	dir := mkTempDir(t, "nixpacks.toml")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "nixpacks", candidates[0].Builder)
	assert.Equal(t, 0.95, candidates[0].Confidence)
}

func TestDiscover_PackageJSON(t *testing.T) {
	dir := mkTempDir(t, "package.json")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "nixpacks", candidates[0].Builder)
	assert.Contains(t, candidates[0].Reason, "Node.js")
}

func TestDiscover_GoMod(t *testing.T) {
	dir := mkTempDir(t, "go.mod")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "nixpacks", candidates[0].Builder)
	assert.Contains(t, candidates[0].Reason, "Go")
}

func TestDiscover_RequirementsTxt(t *testing.T) {
	dir := mkTempDir(t, "requirements.txt")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "nixpacks", candidates[0].Builder)
	assert.Contains(t, candidates[0].Reason, "Python")
	assert.Contains(t, candidates[0].Reason, "requirements.txt")
}

func TestDiscover_CargoToml(t *testing.T) {
	dir := mkTempDir(t, "Cargo.toml")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "nixpacks", candidates[0].Builder)
	assert.Contains(t, candidates[0].Reason, "Rust")
}

func TestDiscover_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	candidates, err := Discover(dir)
	require.NoError(t, err)
	assert.Empty(t, candidates)
}

func TestDiscover_DockerfileAndPackageJSON(t *testing.T) {
	dir := mkTempDir(t, "Dockerfile", "package.json")
	candidates, err := Discover(dir)
	require.NoError(t, err)
	require.Len(t, candidates, 2)
	assert.Equal(t, "docker", candidates[0].Builder)
	assert.Equal(t, 1.0, candidates[0].Confidence)
	assert.Equal(t, "nixpacks", candidates[1].Builder)
}
