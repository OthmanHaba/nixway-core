package ssh

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	gossh "golang.org/x/crypto/ssh"
)

func Fingerprint(publicKey []byte) (string, error) {
	key, _, _, _, err := gossh.ParseAuthorizedKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("parse public key: %w", err)
	}
	hash := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.StdEncoding.EncodeToString(hash[:]), nil
}
