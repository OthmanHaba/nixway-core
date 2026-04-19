package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var ErrSessionNotFound = errors.New("session not found")

type SessionData struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email"`
	Name   string    `json:"name"`
}

type SessionStore interface {
	Set(ctx context.Context, key, value string, ttl time.Duration) error
	Get(ctx context.Context, key string) (string, error)
	Del(ctx context.Context, keys ...string) error
}

type SessionManager struct {
	store SessionStore
	ttl   time.Duration
}

func NewSessionManager(store SessionStore, ttl time.Duration) *SessionManager {
	return &SessionManager{store: store, ttl: ttl}
}

func (m *SessionManager) Create(ctx context.Context, userID uuid.UUID, email, name string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate session id: %w", err)
	}
	sessionID := base64.URLEncoding.EncodeToString(b)

	data := SessionData{UserID: userID, Email: email, Name: name}
	jsonData, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("marshal session: %w", err)
	}

	key := fmt.Sprintf("session:%s", sessionID)
	if err := m.store.Set(ctx, key, string(jsonData), m.ttl); err != nil {
		return "", fmt.Errorf("store session: %w", err)
	}
	return sessionID, nil
}

func (m *SessionManager) Get(ctx context.Context, sessionID string) (*SessionData, error) {
	key := fmt.Sprintf("session:%s", sessionID)
	val, err := m.store.Get(ctx, key)
	if err != nil {
		return nil, ErrSessionNotFound
	}
	var data SessionData
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, fmt.Errorf("unmarshal session: %w", err)
	}
	return &data, nil
}

func (m *SessionManager) Delete(ctx context.Context, sessionID string) error {
	key := fmt.Sprintf("session:%s", sessionID)
	return m.store.Del(ctx, key)
}
