package provisioner

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetScript_ValidComponents(t *testing.T) {
	for _, component := range []string{"docker", "traefik", "nixpacks", "buildpacks", "railpack", "agent"} {
		t.Run(component, func(t *testing.T) {
			script, err := GetScript(component)
			require.NoError(t, err)
			assert.NotEmpty(t, script)
			assert.Contains(t, string(script), "#!/bin/bash")
		})
	}
}

func TestGetScript_InvalidComponent(t *testing.T) {
	_, err := GetScript("nonexistent")
	assert.Error(t, err)
}

func TestIsValidComponent(t *testing.T) {
	valid := []string{"docker", "traefik", "nixpacks", "buildpacks", "railpack", "agent"}
	for _, c := range valid {
		assert.True(t, IsValidComponent(c), "%s should be valid", c)
	}

	invalid := []string{"", "invalid", "Docker", "TRAEFIK", "postgres"}
	for _, c := range invalid {
		assert.False(t, IsValidComponent(c), "%s should be invalid", c)
	}
}

func TestGetAgentScript_TemplateReplacement(t *testing.T) {
	script, err := GetAgentScript("https://example.com", "localhost:9090", "test-server-id-123")
	require.NoError(t, err)

	s := string(script)
	assert.Contains(t, s, "https://example.com")
	assert.Contains(t, s, "localhost:9090")
	assert.Contains(t, s, "test-server-id-123")
	assert.NotContains(t, s, "__API_URL__")
	assert.NotContains(t, s, "__GRPC_ADDR__")
	assert.NotContains(t, s, "__SERVER_ID__")
}

func TestAvailableComponents(t *testing.T) {
	assert.Len(t, AvailableComponents, 6)
	assert.Contains(t, AvailableComponents, "docker")
	assert.Contains(t, AvailableComponents, "agent")
}
