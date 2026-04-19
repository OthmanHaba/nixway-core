package provisioner

import "embed"

//go:embed scripts/*.sh
var Scripts embed.FS

func GetScript(component string) ([]byte, error) {
	return Scripts.ReadFile("scripts/" + component + ".sh")
}

var AvailableComponents = []string{"docker", "traefik", "nixpacks", "buildpacks", "railpack"}

func IsValidComponent(name string) bool {
	for _, c := range AvailableComponents {
		if c == name {
			return true
		}
	}
	return false
}
