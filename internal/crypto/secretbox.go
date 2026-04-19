package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/nacl/secretbox"
)

const KeySize = 32
const nonceSize = 24

func GenerateMasterKey() [KeySize]byte {
	var key [KeySize]byte
	if _, err := rand.Read(key[:]); err != nil {
		panic(err)
	}
	return key
}

func deriveKey(masterKey [KeySize]byte, context string) [KeySize]byte {
	var derived [KeySize]byte
	r := hkdf.New(sha256.New, masterKey[:], []byte("nixway-secretbox"), []byte(context))
	if _, err := io.ReadFull(r, derived[:]); err != nil {
		panic(err)
	}
	return derived
}

func Encrypt(plaintext []byte, masterKey [KeySize]byte, context string) ([]byte, error) {
	key := deriveKey(masterKey, context)
	var nonce [nonceSize]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, err
	}
	encrypted := secretbox.Seal(nonce[:], plaintext, &nonce, &key)
	return encrypted, nil
}

func Decrypt(ciphertext []byte, masterKey [KeySize]byte, context string) ([]byte, error) {
	key := deriveKey(masterKey, context)
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	var nonce [nonceSize]byte
	copy(nonce[:], ciphertext[:nonceSize])
	decrypted, ok := secretbox.Open(nil, ciphertext[nonceSize:], &nonce, &key)
	if !ok {
		return nil, errors.New("decryption failed")
	}
	return decrypted, nil
}

func MasterKeyFromHex(hexStr string) ([KeySize]byte, error) {
	var key [KeySize]byte
	b, err := hex.DecodeString(hexStr)
	if err != nil {
		return key, errors.New("invalid hex in master key")
	}
	if len(b) != KeySize {
		return key, errors.New("master key must be 32 bytes (64 hex chars)")
	}
	copy(key[:], b)
	return key, nil
}
