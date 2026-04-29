// Package database orchestrates the provisioning, lifecycle, and credential
// management of platform-managed database instances (PostgreSQL, MySQL, Redis,
// MongoDB, RabbitMQ, MinIO, Meilisearch). Templates and storage volumes are
// owned by sibling packages; this package wires them into the deploy pipeline
// and exposes a project-scoped CRUD API.
package database

import (
	"crypto/rand"
	"encoding/base64"
)

// GeneratePassword returns a 32-character cryptographically random password
// suitable for DB credentials. Uses URL-safe base64 (no special chars that
// might trip up shell escaping or env var injection).
func GeneratePassword() (string, error) {
	b := make([]byte, 24) // 24 bytes -> 32 base64 chars
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
