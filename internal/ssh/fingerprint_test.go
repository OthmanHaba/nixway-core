package ssh_test

import (
	"strings"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/ssh"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFingerprint(t *testing.T) {
	pub, _, err := ssh.GenerateKeyPair("ed25519")
	require.NoError(t, err)

	fp, err := ssh.Fingerprint(pub)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(fp, "SHA256:"), "fingerprint should start with SHA256:")
}

func TestFingerprintRSA(t *testing.T) {
	pub, _, err := ssh.GenerateKeyPair("rsa")
	require.NoError(t, err)

	fp, err := ssh.Fingerprint(pub)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(fp, "SHA256:"), "fingerprint should start with SHA256:")
}

func TestFingerprintInvalid(t *testing.T) {
	_, err := ssh.Fingerprint([]byte("not a valid public key"))
	assert.Error(t, err)
}
