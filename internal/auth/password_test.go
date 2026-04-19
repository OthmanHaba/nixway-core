package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashPassword(t *testing.T) {
	hash, err := HashPassword("mysecretpassword", 10)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)
	assert.NotEqual(t, "mysecretpassword", hash)
}

func TestCheckPassword(t *testing.T) {
	hash, err := HashPassword("correctpassword", 10)
	require.NoError(t, err)

	assert.True(t, CheckPassword("correctpassword", hash), "correct password should return true")
	assert.False(t, CheckPassword("wrongpassword", hash), "wrong password should return false")
}

func TestValidatePasswordStrength(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"too short", "abc", true},
		{"exactly 7 chars", "1234567", true},
		{"exactly 8 chars", "12345678", false},
		{"long password", "averylongpassword123!", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePasswordStrength(tc.password)
			if tc.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
