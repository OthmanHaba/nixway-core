package provisioner

import (
	"embed"
	"strings"
)

//go:embed scripts/*.sh
var Scripts embed.FS

func GetScript(component string) ([]byte, error) {
	return Scripts.ReadFile("scripts/" + component + ".sh")
}

var AvailableComponents = []string{"docker", "traefik", "nixpacks", "buildpacks", "railpack", "agent"}

func IsValidComponent(name string) bool {
	for _, c := range AvailableComponents {
		if c == name {
			return true
		}
	}
	return false
}

// GetAgentScript returns the agent installer script with templated values replaced.
func GetAgentScript(apiURL, grpcAddr, serverID string) ([]byte, error) {
	script, err := GetScript("agent")
	if err != nil {
		return nil, err
	}
	s := string(script)
	s = strings.ReplaceAll(s, "__API_URL__", apiURL)
	s = strings.ReplaceAll(s, "__GRPC_ADDR__", grpcAddr)
	s = strings.ReplaceAll(s, "__SERVER_ID__", serverID)
	return []byte(s), nil
}
