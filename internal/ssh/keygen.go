package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"

	gossh "golang.org/x/crypto/ssh"
)

func GenerateKeyPair(keyType string) (publicKey []byte, privateKey []byte, err error) {
	switch keyType {
	case "ed25519":
		return generateEd25519()
	case "rsa":
		return generateRSA(4096)
	default:
		return nil, nil, fmt.Errorf("unsupported key type: %s (use ed25519 or rsa)", keyType)
	}
}

func generateEd25519() ([]byte, []byte, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	sshPub, err := gossh.NewPublicKey(pub)
	if err != nil {
		return nil, nil, err
	}
	pubBytes := gossh.MarshalAuthorizedKey(sshPub)
	privBlock, err := gossh.MarshalPrivateKey(priv, "")
	if err != nil {
		return nil, nil, err
	}
	privBytes := pem.EncodeToMemory(privBlock)
	return pubBytes, privBytes, nil
}

func generateRSA(bits int) ([]byte, []byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return nil, nil, err
	}
	sshPub, err := gossh.NewPublicKey(&key.PublicKey)
	if err != nil {
		return nil, nil, err
	}
	pubBytes := gossh.MarshalAuthorizedKey(sshPub)
	privBlock, err := gossh.MarshalPrivateKey(key, "")
	if err != nil {
		return nil, nil, err
	}
	privBytes := pem.EncodeToMemory(privBlock)
	return pubBytes, privBytes, nil
}
