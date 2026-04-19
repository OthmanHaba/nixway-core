package ssh_test

import (
	"strings"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/ssh"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateKeyPairEd25519(t *testing.T) {
	pub, priv, err := ssh.GenerateKeyPair("ed25519")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(string(pub), "ssh-ed25519 "), "public key should start with ssh-ed25519")
	assert.Contains(t, string(priv), "-----BEGIN OPENSSH PRIVATE KEY-----")
	assert.Contains(t, string(priv), "-----END OPENSSH PRIVATE KEY-----")
}

func TestGenerateKeyPairRSA(t *testing.T) {
	pub, priv, err := ssh.GenerateKeyPair("rsa")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(string(pub), "ssh-rsa "), "public key should start with ssh-rsa")
	assert.Contains(t, string(priv), "-----BEGIN OPENSSH PRIVATE KEY-----")
	assert.Contains(t, string(priv), "-----END OPENSSH PRIVATE KEY-----")
}

func TestGenerateKeyPairInvalidType(t *testing.T) {
	_, _, err := ssh.GenerateKeyPair("ecdsa")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported key type")
}
