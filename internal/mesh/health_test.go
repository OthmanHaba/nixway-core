package mesh

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDeriveClusterStatus_AllActive(t *testing.T) {
	assert.Equal(t, "active", DeriveClusterStatus([]string{"active", "active", "active"}))
}

func TestDeriveClusterStatus_SomeDegraded(t *testing.T) {
	assert.Equal(t, "degraded", DeriveClusterStatus([]string{"active", "degraded", "active"}))
}

func TestDeriveClusterStatus_SomeFailed(t *testing.T) {
	assert.Equal(t, "degraded", DeriveClusterStatus([]string{"active", "failed", "active", "active"}))
}

func TestDeriveClusterStatus_MajorityFailed(t *testing.T) {
	assert.Equal(t, "error", DeriveClusterStatus([]string{"failed", "failed", "active"}))
}

func TestDeriveClusterStatus_Empty(t *testing.T) {
	assert.Equal(t, "active", DeriveClusterStatus(nil))
}

func TestDerivePeerStatus(t *testing.T) {
	assert.Equal(t, "active", DerivePeerStatus(true, 100, 200))
	assert.Equal(t, "degraded", DerivePeerStatus(true, 100, 400))
	assert.Equal(t, "degraded", DerivePeerStatus(true, 600, 100))
	assert.Equal(t, "failed", DerivePeerStatus(false, 0, 0))
}
