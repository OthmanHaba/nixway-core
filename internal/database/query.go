package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// queryRequestTimeout caps how long ExecuteQuery will wait for a result from
// the agent before giving up. The agent enforces its own per-query timeout
// (default 30s); this is the outer bound for the whole orchestration.
const queryRequestTimeout = 60 * time.Second

// queryDefaultMaxRows mirrors the agent default — kept here so the control
// plane can document the hard cap to clients.
const queryDefaultMaxRows = 1000

// queryRateLimitPerSecond is the per-user query rate limit.
const queryRateLimitPerSecond = 10

// QueryRequest is the input to the query runner.
type QueryRequest struct {
	DatabaseID uuid.UUID
	UserID     uuid.UUID
	Query      string
	WriteMode  bool
	Operation  string            // "select" if empty
	Params     map[string]string // operation-specific
	TimeoutSec int               // 0 = default 30
	MaxRows    int               // 0 = default 1000
}

// QueryColumn is the JSON shape of a result column.
type QueryColumn struct {
	Name     string `json:"name"`
	TypeName string `json:"type_name,omitempty"`
}

// QueryRow is one row of values; Nulls is parallel to Values.
type QueryRow struct {
	Values []string `json:"values"`
	Nulls  []bool   `json:"nulls"`
}

// QueryResult is the synchronous result returned to HTTP callers.
type QueryResult struct {
	Success         bool          `json:"success"`
	Error           string        `json:"error,omitempty"`
	ExecutionTimeMS int64         `json:"execution_time_ms"`
	Columns         []QueryColumn `json:"columns,omitempty"`
	Rows            []QueryRow    `json:"rows,omitempty"`
	AffectedRows    int           `json:"affected_rows,omitempty"`
	RawText         string        `json:"raw_text,omitempty"`
	QueryHistoryID  uuid.UUID     `json:"query_history_id"`
	Truncated       bool          `json:"truncated,omitempty"`
}

// ddlKeywords are blocked even in write_mode.
var ddlKeywords = map[string]struct{}{
	"DROP": {}, "ALTER": {}, "TRUNCATE": {}, "CREATE": {}, "GRANT": {}, "REVOKE": {},
}

// readKeywords are the only allowed leading verbs when write_mode == false
// for SQL databases.
var readKeywords = map[string]struct{}{
	"SELECT": {}, "SHOW": {}, "EXPLAIN": {}, "WITH": {}, "DESCRIBE": {}, "DESC": {},
}

// firstQueryKeyword extracts the leading SQL keyword (uppercase) so we can
// gate write/DDL access. Empty when the query has no readable token.
func firstQueryKeyword(query string) string {
	q := strings.TrimLeft(strings.TrimSpace(query), "(\"`'[ \t\n;")
	if q == "" {
		return ""
	}
	parts := strings.FieldsFunc(q, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == ';' || r == '('
	})
	if len(parts) == 0 {
		return ""
	}
	return strings.ToUpper(parts[0])
}

// IsDDL returns true when the query's first keyword is a DDL verb.
func IsDDL(query string) bool {
	_, ok := ddlKeywords[firstQueryKeyword(query)]
	return ok
}

// dbTypeForQueryTemplate maps a template slug to the database_type the agent
// understands. Mirrors dbTypeForTemplate in rotation.go but kept local to
// avoid coupling.
func dbTypeForQueryTemplate(slug string) string {
	switch slug {
	case "postgres", "postgresql":
		return "postgresql"
	case "mysql", "mariadb":
		return "mysql"
	case "mongodb", "mongo":
		return "mongodb"
	case "redis":
		return "redis"
	default:
		return slug
	}
}

// isSQLDB returns true when the database type is one of the SQL flavours.
// Used to decide whether the read/write keyword check applies.
func isSQLDB(dbType string) bool {
	switch dbType {
	case "postgresql", "mysql":
		return true
	}
	return false
}

// SetRedis wires the Redis client used for per-user rate limiting. Safe to
// leave unset (rate limiting is then a no-op).
func (s *Service) SetRedis(client *redis.Client) {
	s.redis = client
}

// pgUUIDOrNull turns a uuid.UUID into a pgtype.UUID where uuid.Nil maps to
// SQL NULL. Used by ListQueryHistory to make the database_id filter optional.
func pgUUIDOrNull(id uuid.UUID) pgtype.UUID {
	if id == uuid.Nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: id, Valid: true}
}

// ExecuteQuery is the main entry point for the database tooling UI. It
// validates, rate-limits, sends the relay command to the agent on the
// database's host, awaits the result, audit-logs, and returns.
func (s *Service) ExecuteQuery(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	d, err := s.queries.GetDatabase(ctx, req.DatabaseID)
	if err != nil {
		return nil, fmt.Errorf("get database: %w", err)
	}
	if d.Status != StatusRunning {
		return nil, fmt.Errorf("database not running (status=%s)", d.Status)
	}

	tmpl, ok := s.templateReg.Get(d.TemplateSlug)
	if !ok {
		return nil, fmt.Errorf("template not found: %s", d.TemplateSlug)
	}

	dbType := dbTypeForQueryTemplate(d.TemplateSlug)

	// Validate query for SQL databases when an explicit query is provided
	// (operations like list_schemas synthesize SQL on the agent).
	op := strings.ToLower(strings.TrimSpace(req.Operation))
	rawQuery := req.Query
	if isSQLDB(dbType) && (op == "" || op == "select") {
		if strings.TrimSpace(rawQuery) == "" {
			return nil, errors.New("query is required")
		}
		kw := firstQueryKeyword(rawQuery)
		if _, isDDL := ddlKeywords[kw]; isDDL {
			return nil, errors.New("DDL is not permitted (DROP/ALTER/TRUNCATE/CREATE/GRANT/REVOKE)")
		}
		if !req.WriteMode {
			if _, isRead := readKeywords[kw]; !isRead {
				return nil, fmt.Errorf("write_mode is off; query must start with SELECT/SHOW/EXPLAIN/WITH/DESCRIBE (got %q)", kw)
			}
		}
	}

	// Rate limit per user. Best-effort — failures don't block the query.
	if err := s.rateLimitPerUser(ctx, req.UserID); err != nil {
		return nil, err
	}

	// Resolve app-user password (NEVER superuser).
	envNS := "database:" + d.Name
	resolved, err := s.secretSvc.BulkResolve(ctx, d.TeamID, envNS, []string{"APP_PASSWORD"}, &req.UserID, "user")
	if err != nil {
		return nil, fmt.Errorf("resolve app credentials: %w", err)
	}
	password := resolved["APP_PASSWORD"]

	// Build host: prefer DNS record, fall back to localhost (agent on same host).
	host := "localhost"
	if d.DnsRecord != nil && *d.DnsRecord != "" {
		host = *d.DnsRecord
	}

	// Resolve agent.
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: d.ServerID, TeamID: d.TeamID})
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		return nil, errors.New("server has no connected agent")
	}

	requestID := uuid.NewString()
	ch := make(chan *agentv1.DatabaseQueryResult, 1)
	s.mu.Lock()
	if s.pendingQuery == nil {
		s.pendingQuery = make(map[string]chan *agentv1.DatabaseQueryResult)
	}
	s.pendingQuery[requestID] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pendingQuery, requestID)
		s.mu.Unlock()
	}()

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	maxRows := req.MaxRows
	if maxRows <= 0 {
		maxRows = queryDefaultMaxRows
	}

	port := d.Port
	if port == 0 && len(tmpl.Ports) > 0 {
		port = int32(tmpl.Ports[0])
	}

	cmd := &agentv1.DatabaseQueryCommand{
		RequestId:      requestID,
		DatabaseId:     d.ID.String(),
		DatabaseType:   dbType,
		ContainerName:  d.ContainerName,
		Host:           host,
		Port:           port,
		Username:       "app_user",
		Password:       password,
		Dbname:         d.Name,
		Query:          rawQuery,
		WriteMode:      req.WriteMode,
		TimeoutSeconds: int32(timeoutSec),
		MaxRows:        int32(maxRows),
		Operation:      op,
		Params:         req.Params,
	}
	if err := s.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_DatabaseQuery{DatabaseQuery: cmd},
	}); err != nil {
		return nil, fmt.Errorf("send to agent: %w", err)
	}

	// Wait for the result.
	timeout := queryRequestTimeout
	select {
	case res := <-ch:
		out := mapAgentResult(res)
		out.QueryHistoryID = s.recordQueryHistory(ctx, req, d.ID, out)
		return out, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(timeout):
		return nil, errors.New("timed out waiting for agent query result")
	}
}

// HandleQueryResult is the agent.Server callback that routes incoming
// results to the in-flight ExecuteQuery caller.
func (s *Service) HandleQueryResult(ctx context.Context, result *agentv1.DatabaseQueryResult) {
	if result == nil || result.RequestId == "" {
		return
	}
	s.mu.Lock()
	ch, ok := s.pendingQuery[result.RequestId]
	if ok {
		delete(s.pendingQuery, result.RequestId)
	}
	s.mu.Unlock()
	if !ok {
		return
	}
	select {
	case ch <- result:
	default:
	}
}

// mapAgentResult flattens a proto result into the JSON-friendly QueryResult.
func mapAgentResult(res *agentv1.DatabaseQueryResult) *QueryResult {
	out := &QueryResult{
		Success:         res.Success,
		Error:           res.Error,
		ExecutionTimeMS: res.ExecutionTimeMs,
		AffectedRows:    int(res.AffectedRows),
		RawText:         res.RawText,
		Truncated:       res.Truncated,
	}
	for _, c := range res.Columns {
		out.Columns = append(out.Columns, QueryColumn{Name: c.Name, TypeName: c.TypeName})
	}
	for _, r := range res.Rows {
		out.Rows = append(out.Rows, QueryRow{Values: append([]string(nil), r.Values...), Nulls: append([]bool(nil), r.Nulls...)})
	}
	return out
}

// recordQueryHistory persists every executed query (success or failure) for
// audit and "query history" UI. Best-effort — failure here does not affect
// the caller's result.
func (s *Service) recordQueryHistory(ctx context.Context, req QueryRequest, dbID uuid.UUID, res *QueryResult) uuid.UUID {
	queryText := req.Query
	if queryText == "" {
		queryText = "[" + strings.ToLower(req.Operation) + "]"
	}
	if len(queryText) > 8192 {
		queryText = queryText[:8192]
	}
	execMS := int32(res.ExecutionTimeMS)
	rowCount := int32(len(res.Rows))
	if rowCount == 0 && res.AffectedRows > 0 {
		rowCount = int32(res.AffectedRows)
	}
	var errPtr *string
	if res.Error != "" {
		e := res.Error
		errPtr = &e
	}
	row, err := s.queries.CreateDatabaseQueryHistory(ctx, db.CreateDatabaseQueryHistoryParams{
		UserID:          req.UserID,
		DatabaseID:      dbID,
		QueryText:       queryText,
		WriteMode:       req.WriteMode,
		ExecutionTimeMs: &execMS,
		RowCount:        &rowCount,
		Error:           errPtr,
	})
	if err != nil {
		s.logger.Warn("record query history failed", "database_id", dbID, "error", err)
		return uuid.Nil
	}
	return row.ID
}

// rateLimitPerUser implements a 10-queries-per-second per-user counter
// backed by Redis. When Redis is unavailable, rate limiting is skipped.
func (s *Service) rateLimitPerUser(ctx context.Context, userID uuid.UUID) error {
	if s.redis == nil || userID == uuid.Nil {
		return nil
	}
	key := fmt.Sprintf("qr:rl:%s", userID.String())
	count, err := s.redis.Incr(ctx, key).Result()
	if err != nil {
		// Don't block on Redis failures.
		s.logger.Debug("rate limit increment failed", "error", err)
		return nil
	}
	if count == 1 {
		_ = s.redis.Expire(ctx, key, time.Second).Err()
	}
	if count > queryRateLimitPerSecond {
		return fmt.Errorf("rate limit exceeded (%d queries/sec per user)", queryRateLimitPerSecond)
	}
	return nil
}

// ListQueryHistory returns the user's recent query history, optionally
// scoped to a single database. Pass uuid.Nil to omit the database filter.
func (s *Service) ListQueryHistory(ctx context.Context, userID, databaseID uuid.UUID, limit int) ([]db.DatabaseQueryHistory, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var dbIDArg = pgUUIDOrNull(databaseID)
	rows, err := s.queries.ListDatabaseQueryHistoryByUser(ctx, db.ListDatabaseQueryHistoryByUserParams{
		UserID:     userID,
		DatabaseID: dbIDArg,
		LimitCount: int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("list query history: %w", err)
	}
	return rows, nil
}
