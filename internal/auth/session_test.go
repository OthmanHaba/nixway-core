package auth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockStore is an in-memory SessionStore for testing.
type mockStore struct {
	mu   sync.RWMutex
	data map[string]string
}

func newMockStore() *mockStore {
	return &mockStore{data: make(map[string]string)}
}

func (m *mockStore) Set(_ context.Context, key, value string, _ time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = value
	return nil
}

func (m *mockStore) Get(_ context.Context, key string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.data[key]
	if !ok {
		return "", errors.New("not found")
	}
	return v, nil
}

func (m *mockStore) Del(_ context.Context, keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range keys {
		delete(m.data, k)
	}
	return nil
}

func TestSessionManager_CreateAndGet(t *testing.T) {
	store := newMockStore()
	mgr := NewSessionManager(store, 30*time.Minute)
	ctx := context.Background()

	userID := uuid.New()
	sessionID, err := mgr.Create(ctx, userID, "alice@example.com", "Alice")
	require.NoError(t, err)
	assert.NotEmpty(t, sessionID)

	data, err := mgr.Get(ctx, sessionID)
	require.NoError(t, err)
	assert.Equal(t, userID, data.UserID)
	assert.Equal(t, "alice@example.com", data.Email)
	assert.Equal(t, "Alice", data.Name)
}

func TestSessionManager_Delete(t *testing.T) {
	store := newMockStore()
	mgr := NewSessionManager(store, 30*time.Minute)
	ctx := context.Background()

	sessionID, err := mgr.Create(ctx, uuid.New(), "bob@example.com", "Bob")
	require.NoError(t, err)

	err = mgr.Delete(ctx, sessionID)
	require.NoError(t, err)
}

func TestSessionManager_GetAfterDelete(t *testing.T) {
	store := newMockStore()
	mgr := NewSessionManager(store, 30*time.Minute)
	ctx := context.Background()

	sessionID, err := mgr.Create(ctx, uuid.New(), "carol@example.com", "Carol")
	require.NoError(t, err)

	require.NoError(t, mgr.Delete(ctx, sessionID))

	_, err = mgr.Get(ctx, sessionID)
	assert.ErrorIs(t, err, ErrSessionNotFound)
}
