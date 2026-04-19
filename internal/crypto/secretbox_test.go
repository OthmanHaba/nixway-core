package crypto_test

import (
	"fmt"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	masterKey := crypto.GenerateMasterKey()
	plaintext := []byte("ssh private key content here")
	encrypted, err := crypto.Encrypt(plaintext, masterKey, "team-123")
	require.NoError(t, err)
	assert.NotEqual(t, plaintext, encrypted)

	decrypted, err := crypto.Decrypt(encrypted, masterKey, "team-123")
	require.NoError(t, err)
	assert.Equal(t, plaintext, decrypted)
}

func TestDecryptWrongKey(t *testing.T) {
	key1 := crypto.GenerateMasterKey()
	key2 := crypto.GenerateMasterKey()
	encrypted, err := crypto.Encrypt([]byte("secret"), key1, "team-1")
	require.NoError(t, err)
	_, err = crypto.Decrypt(encrypted, key2, "team-1")
	assert.Error(t, err)
}

func TestDecryptWrongContext(t *testing.T) {
	key := crypto.GenerateMasterKey()
	encrypted, err := crypto.Encrypt([]byte("secret"), key, "team-1")
	require.NoError(t, err)
	_, err = crypto.Decrypt(encrypted, key, "team-2")
	assert.Error(t, err)
}

func TestMasterKeyFromHex(t *testing.T) {
	key := crypto.GenerateMasterKey()
	hexStr := ""
	for _, b := range key {
		hexStr += fmt.Sprintf("%02x", b)
	}
	parsed, err := crypto.MasterKeyFromHex(hexStr)
	require.NoError(t, err)
	assert.Equal(t, key, parsed)
}

func TestMasterKeyFromHexInvalid(t *testing.T) {
	_, err := crypto.MasterKeyFromHex("tooshort")
	assert.Error(t, err)
}
