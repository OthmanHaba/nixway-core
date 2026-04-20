package cluster

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAllocateClusterCIDR(t *testing.T) {
	alloc := NewCIDRAllocator("10.100.0.0/10")

	cidr1, err := alloc.AllocateClusterCIDR(nil)
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.0/16", cidr1.String())

	cidr2, err := alloc.AllocateClusterCIDR([]string{"10.100.0.0/16"})
	require.NoError(t, err)
	assert.Equal(t, "10.101.0.0/16", cidr2.String())
}

func TestAllocateClusterCIDR_SkipsUsed(t *testing.T) {
	alloc := NewCIDRAllocator("10.100.0.0/10")

	cidr, err := alloc.AllocateClusterCIDR([]string{"10.100.0.0/16", "10.101.0.0/16"})
	require.NoError(t, err)
	assert.Equal(t, "10.102.0.0/16", cidr.String())
}

func TestAllocateServerIP(t *testing.T) {
	alloc := NewCIDRAllocator("10.100.0.0/10")

	ip1, err := alloc.AllocateServerIP("10.100.0.0/16", nil)
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.1", ip1.String())

	ip2, err := alloc.AllocateServerIP("10.100.0.0/16", []string{"10.100.0.1"})
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.2", ip2.String())
}

func TestAllocateServerIP_SkipsUsed(t *testing.T) {
	alloc := NewCIDRAllocator("10.100.0.0/10")

	ip, err := alloc.AllocateServerIP("10.100.0.0/16", []string{"10.100.0.1", "10.100.0.2"})
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.3", ip.String())
}

func TestAllocateServerIP_SkipsNetworkAddress(t *testing.T) {
	alloc := NewCIDRAllocator("10.100.0.0/10")

	ip, err := alloc.AllocateServerIP("10.100.0.0/16", nil)
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.1", ip.String())
}

func TestAllocateClusterCIDR_Exhausted(t *testing.T) {
	// Use a tiny pool /30 — only 4 IPs, but we allocate /16 blocks so none fit
	// Actually test with a small range
	alloc := NewCIDRAllocator("10.100.0.0/15") // only 10.100.x.x and 10.101.x.x

	_, err := alloc.AllocateClusterCIDR(nil)
	require.NoError(t, err)

	_, err = alloc.AllocateClusterCIDR([]string{"10.100.0.0/16"})
	require.NoError(t, err)

	_, err = alloc.AllocateClusterCIDR([]string{"10.100.0.0/16", "10.101.0.0/16"})
	assert.Error(t, err, "should error when pool is exhausted")
}
