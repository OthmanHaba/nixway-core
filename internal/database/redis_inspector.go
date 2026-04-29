package database

import (
	"context"
	"strconv"

	"github.com/google/uuid"
)

// RedisListKeys uses cursor-based SCAN to enumerate keys matching pattern.
// The agent returns a JSON object with the keys + next_cursor in RawText.
func (s *Service) RedisListKeys(ctx context.Context, userID, dbID uuid.UUID, pattern, cursor string, count int) (*QueryResult, error) {
	if pattern == "" {
		pattern = "*"
	}
	if count <= 0 {
		count = 100
	}
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "redis_keys",
		Params: map[string]string{
			"pattern": pattern,
			"cursor":  cursor,
			"count":   strconv.Itoa(count),
		},
	})
}

// RedisGetKey returns the type-aware value of a single key plus its TTL.
// The agent uses GET/HGETALL/LRANGE/SMEMBERS/ZRANGE/XRANGE depending on type.
func (s *Service) RedisGetKey(ctx context.Context, userID, dbID uuid.UUID, key string) (*QueryResult, error) {
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "redis_get",
		Params:     map[string]string{"key": key},
	})
}

// RedisInfo returns the live INFO output. Optional section filters to one of
// the standard INFO sections (memory, clients, stats, replication, etc).
func (s *Service) RedisInfo(ctx context.Context, userID, dbID uuid.UUID, section string) (*QueryResult, error) {
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "redis_info",
		Params:     map[string]string{"section": section},
	})
}

// RedisConfig returns CONFIG GET <pattern> as a flat key/value map encoded
// in the result's RawText.
func (s *Service) RedisConfig(ctx context.Context, userID, dbID uuid.UUID, pattern string) (*QueryResult, error) {
	if pattern == "" {
		pattern = "*"
	}
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "redis_config",
		Params:     map[string]string{"pattern": pattern},
	})
}
