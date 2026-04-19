package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateAPIToken_Prefix(t *testing.T) {
	plain, hash, err := GenerateAPIToken(32)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(plain, "nxw_"), "token should start with nxw_")
	assert.NotEmpty(t, hash)
}

func TestHashToken_Deterministic(t *testing.T) {
	input := "nxw_sometoken"
	h1 := HashToken(input)
	h2 := HashToken(input)
	assert.Equal(t, h1, h2, "HashToken should be deterministic")
}

func TestGenerateAPIToken_DifferentHashesForDifferentTokens(t *testing.T) {
	plain1, hash1, err := GenerateAPIToken(32)
	require.NoError(t, err)
	plain2, hash2, err := GenerateAPIToken(32)
	require.NoError(t, err)

	assert.NotEqual(t, plain1, plain2, "tokens should differ")
	assert.NotEqual(t, hash1, hash2, "hashes of different tokens should differ")
}
