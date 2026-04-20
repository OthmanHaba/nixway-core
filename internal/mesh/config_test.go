package mesh

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateConfig_SingleNode(t *testing.T) {
	members := []MemberInfo{
		{WireGuardIP: "10.100.0.1", PublicKey: "key1", Endpoint: "1.2.3.4:51820", ListenPort: 51820},
	}
	cfg, err := GenerateConfig(members[0], members)
	require.NoError(t, err)
	assert.Contains(t, cfg, "Address = 10.100.0.1/32")
	assert.Contains(t, cfg, "ListenPort = 51820")
	assert.NotContains(t, cfg, "[Peer]")
}

func TestGenerateConfig_ThreeNodes(t *testing.T) {
	members := []MemberInfo{
		{WireGuardIP: "10.100.0.1", PublicKey: "key1", Endpoint: "1.2.3.4:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.2", PublicKey: "key2", Endpoint: "5.6.7.8:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.3", PublicKey: "key3", Endpoint: "9.10.11.12:51820", ListenPort: 51820},
	}

	cfg, err := GenerateConfig(members[0], members)
	require.NoError(t, err)
	assert.Contains(t, cfg, "Address = 10.100.0.1/32")
	assert.Contains(t, cfg, "PublicKey = key2")
	assert.Contains(t, cfg, "PublicKey = key3")
	assert.Contains(t, cfg, "AllowedIPs = 10.100.0.2/32")
	assert.Contains(t, cfg, "AllowedIPs = 10.100.0.3/32")
	assert.Contains(t, cfg, "PersistentKeepalive = 25")
	assert.NotContains(t, cfg, "PublicKey = key1")
}

func TestGenerateConfig_TwoNodes_EachPerspective(t *testing.T) {
	members := []MemberInfo{
		{WireGuardIP: "10.100.0.1", PublicKey: "keyA", Endpoint: "1.1.1.1:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.2", PublicKey: "keyB", Endpoint: "2.2.2.2:51820", ListenPort: 51820},
	}

	// Node A's config should have B as peer
	cfgA, err := GenerateConfig(members[0], members)
	require.NoError(t, err)
	assert.Contains(t, cfgA, "Address = 10.100.0.1/32")
	assert.Contains(t, cfgA, "PublicKey = keyB")
	assert.NotContains(t, cfgA, "PublicKey = keyA")

	// Node B's config should have A as peer
	cfgB, err := GenerateConfig(members[1], members)
	require.NoError(t, err)
	assert.Contains(t, cfgB, "Address = 10.100.0.2/32")
	assert.Contains(t, cfgB, "PublicKey = keyA")
	assert.NotContains(t, cfgB, "PublicKey = keyB")
}
