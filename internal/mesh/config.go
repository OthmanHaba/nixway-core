package mesh

import (
	"bytes"
	"fmt"
	"text/template"
)

// MemberInfo holds the data needed to generate a WireGuard config.
type MemberInfo struct {
	MemberID    string
	ServerName  string
	AgentID     string
	WireGuardIP string
	PublicKey   string
	Endpoint    string
	ListenPort  int
}

const wgConfigTemplate = `[Interface]
Address = {{.Self.WireGuardIP}}/32
ListenPort = {{.Self.ListenPort}}
PrivateKey = PRIVATE_KEY_PLACEHOLDER
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
{{range .Peers}}
[Peer]
PublicKey = {{.PublicKey}}
AllowedIPs = {{.WireGuardIP}}/32
Endpoint = {{.Endpoint}}
PersistentKeepalive = 25
{{end}}`

type configData struct {
	Self  MemberInfo
	Peers []MemberInfo
}

// GenerateConfig produces a WireGuard config for the given member.
// The PrivateKey line uses a placeholder — the agent replaces it with the actual key.
func GenerateConfig(self MemberInfo, allMembers []MemberInfo) (string, error) {
	var peers []MemberInfo
	for _, m := range allMembers {
		if m.WireGuardIP == self.WireGuardIP {
			continue
		}
		peers = append(peers, m)
	}

	tmpl, err := template.New("wg").Parse(wgConfigTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, configData{Self: self, Peers: peers}); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}
