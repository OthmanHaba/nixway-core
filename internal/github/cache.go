package github

import (
	"sync"
	"time"
)

// TokenCache caches GitHub installation tokens in memory.
type TokenCache struct {
	mu     sync.RWMutex
	tokens map[int64]cachedToken // keyed by installation ID
}

type cachedToken struct {
	token  string
	expiry time.Time
}

func NewTokenCache() *TokenCache {
	return &TokenCache{
		tokens: make(map[int64]cachedToken),
	}
}

// Get returns a cached token if it exists and hasn't expired (with 5-minute buffer).
func (c *TokenCache) Get(installationID int64) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ct, ok := c.tokens[installationID]
	if !ok {
		return "", false
	}
	if time.Now().Add(5 * time.Minute).After(ct.expiry) {
		return "", false
	}
	return ct.token, true
}

// Set stores a token with its expiry.
func (c *TokenCache) Set(installationID int64, token string, expiry time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens[installationID] = cachedToken{token: token, expiry: expiry}
}
