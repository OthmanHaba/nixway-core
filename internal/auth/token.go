package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

const tokenPrefix = "nxw_"

func GenerateAPIToken(length int) (plain string, hash string, err error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate token: %w", err)
	}
	raw := base64.URLEncoding.EncodeToString(b)
	plain = tokenPrefix + raw
	hash = HashToken(plain)
	return plain, hash, nil
}

func HashToken(plain string) string {
	h := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(h[:])
}
