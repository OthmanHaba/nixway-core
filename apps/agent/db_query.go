package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"time"

	gomysql "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// Defaults that mirror the spec.
const (
	queryDefaultTimeoutSec = 30
	queryDefaultMaxRows    = 1000
)

// HandleDatabaseQuery dispatches a single DatabaseQueryCommand to the right
// driver and returns one DatabaseQueryResult. The agent main receive loop is
// responsible for sending the result back over the gRPC stream.
//
// Passwords arrive plaintext (over WireGuard-protected gRPC) and MUST NOT be
// logged. We log only the database type, op, and outcome.
func HandleDatabaseQuery(ctx context.Context, cmd *agentv1.DatabaseQueryCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.DatabaseQueryResult{
		RequestId: cmd.RequestId,
	}
	start := time.Now()

	timeoutSec := cmd.TimeoutSeconds
	if timeoutSec <= 0 {
		timeoutSec = queryDefaultTimeoutSec
	}
	maxRows := cmd.MaxRows
	if maxRows <= 0 {
		maxRows = queryDefaultMaxRows
	}

	qctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	dbType := strings.ToLower(strings.TrimSpace(cmd.DatabaseType))
	switch dbType {
	case "postgresql", "postgres":
		runSQLQuery(qctx, "pgx", buildPGDSN(cmd), cmd, res, maxRows)
	case "mysql", "mariadb":
		runSQLQuery(qctx, "mysql", buildMySQLDSN(cmd), cmd, res, maxRows)
	case "mongodb", "mongo":
		runMongoQuery(qctx, cmd, res, int64(maxRows))
	case "redis":
		runRedisQuery(qctx, cmd, res, int64(maxRows))
	default:
		res.Success = false
		res.Error = "unsupported database_type: " + cmd.DatabaseType
	}

	res.ExecutionTimeMs = time.Since(start).Milliseconds()

	logger.Info("database query handled",
		"database_id", cmd.DatabaseId,
		"db_type", dbType,
		"operation", cmd.Operation,
		"success", res.Success,
		"row_count", len(res.Rows),
		"affected_rows", res.AffectedRows,
		"truncated", res.Truncated,
		"execution_time_ms", res.ExecutionTimeMs,
	)
	sendDatabaseQueryResult(stream, res)
}

// --- Connection-string builders ---

// resolveDBHost returns an IP address suitable for connecting to the database
// container. The agent runs on the host (not in a container), so it can't use
// docker's embedded DNS or the cluster CoreDNS zone. We `docker inspect` the
// container to read its IP on the `nixway` user network. Falls back to the
// caller-supplied host (e.g. when running tests against an external DB).
func resolveDBHost(cmd *agentv1.DatabaseQueryCommand) string {
	if cmd.ContainerName != "" {
		ip, err := dockerInspectIP(cmd.ContainerName)
		if err == nil && ip != "" {
			return ip
		}
	}
	if cmd.Host != "" {
		return cmd.Host
	}
	return "localhost"
}

func dockerInspectIP(container string) (string, error) {
	out, err := exec.Command(
		"docker", "inspect",
		"-f", "{{range $k, $v := .NetworkSettings.Networks}}{{if eq $k \"nixway\"}}{{$v.IPAddress}}{{end}}{{end}}",
		container,
	).Output()
	if err != nil {
		return "", err
	}
	ip := strings.TrimSpace(string(out))
	if ip == "" {
		// Container exists but isn't on the nixway network — fall back to any
		// network's IP.
		out, err = exec.Command(
			"docker", "inspect",
			"-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
			container,
		).Output()
		if err != nil {
			return "", err
		}
		for _, candidate := range strings.Fields(string(out)) {
			if candidate != "" {
				return candidate, nil
			}
		}
	}
	return ip, nil
}

func buildPGDSN(cmd *agentv1.DatabaseQueryCommand) string {
	host := resolveDBHost(cmd)
	port := cmd.Port
	if port == 0 {
		port = 5432
	}
	dbname := cmd.Dbname
	if dbname == "" {
		dbname = "postgres"
	}
	// pgx supports URL-style DSN.
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cmd.Username, cmd.Password),
		Host:   fmt.Sprintf("%s:%d", host, port),
		Path:   "/" + dbname,
	}
	q := u.Query()
	q.Set("sslmode", "disable")
	q.Set("connect_timeout", strconv.Itoa(int(cmd.TimeoutSeconds)))
	u.RawQuery = q.Encode()
	return u.String()
}

func buildMySQLDSN(cmd *agentv1.DatabaseQueryCommand) string {
	host := resolveDBHost(cmd)
	port := cmd.Port
	if port == 0 {
		port = 3306
	}
	cfg := gomysql.NewConfig()
	cfg.User = cmd.Username
	cfg.Passwd = cmd.Password
	cfg.Net = "tcp"
	cfg.Addr = fmt.Sprintf("%s:%d", host, port)
	cfg.DBName = cmd.Dbname
	cfg.AllowNativePasswords = true
	cfg.ParseTime = true
	if cmd.TimeoutSeconds > 0 {
		cfg.Timeout = time.Duration(cmd.TimeoutSeconds) * time.Second
		cfg.ReadTimeout = time.Duration(cmd.TimeoutSeconds) * time.Second
	}
	return cfg.FormatDSN()
}

// --- SQL: postgres + mysql share most of the path ---

// sqlDDLKeywords are blocked even in write_mode.
var sqlDDLKeywords = map[string]struct{}{
	"DROP": {}, "ALTER": {}, "TRUNCATE": {}, "CREATE": {}, "GRANT": {}, "REVOKE": {},
}

// sqlReadKeywords are the only allowed leading verbs when write_mode == false.
var sqlReadKeywords = map[string]struct{}{
	"SELECT": {}, "SHOW": {}, "EXPLAIN": {}, "WITH": {}, "DESCRIBE": {}, "DESC": {},
}

func firstKeyword(query string) string {
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

func runSQLQuery(ctx context.Context, driver, dsn string, cmd *agentv1.DatabaseQueryCommand, res *agentv1.DatabaseQueryResult, maxRows int32) {
	// Build query when an introspection op is requested.
	query, isWrite, err := buildSQLForOperation(driver, cmd)
	if err != nil {
		res.Success = false
		res.Error = err.Error()
		return
	}

	keyword := firstKeyword(query)
	if _, isDDL := sqlDDLKeywords[keyword]; isDDL {
		res.Success = false
		res.Error = "DDL statements are not permitted (DROP/ALTER/TRUNCATE/CREATE/GRANT/REVOKE)"
		return
	}
	if !cmd.WriteMode {
		if _, ok := sqlReadKeywords[keyword]; !ok {
			res.Success = false
			res.Error = fmt.Sprintf("write_mode is off; only read queries (SELECT/SHOW/EXPLAIN/WITH/DESCRIBE) are permitted, got %q", keyword)
			return
		}
	}

	dbConn, err := sql.Open(driver, dsn)
	if err != nil {
		res.Success = false
		res.Error = "open db: " + sanitizeError(err.Error())
		return
	}
	defer dbConn.Close()
	dbConn.SetMaxOpenConns(1)

	// Ping with a short bound so we fail fast if the DB is unreachable.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	if err := dbConn.PingContext(pingCtx); err != nil {
		cancel()
		res.Success = false
		res.Error = "connect: " + sanitizeError(err.Error())
		return
	}
	cancel()

	if isWrite {
		// For writes, ExecContext returns affected_rows.
		execRes, err := dbConn.ExecContext(ctx, query)
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		if n, err := execRes.RowsAffected(); err == nil {
			res.AffectedRows = int32(n)
		}
		res.Success = true
		return
	}

	rows, err := dbConn.QueryContext(ctx, query)
	if err != nil {
		res.Success = false
		res.Error = sanitizeError(err.Error())
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		res.Success = false
		res.Error = sanitizeError(err.Error())
		return
	}
	colTypes, _ := rows.ColumnTypes()
	for i, name := range cols {
		typ := ""
		if colTypes != nil && i < len(colTypes) {
			typ = colTypes[i].DatabaseTypeName()
		}
		res.Columns = append(res.Columns, &agentv1.ColumnMeta{Name: name, TypeName: typ})
	}

	count := int32(0)
	for rows.Next() {
		if count >= maxRows {
			res.Truncated = true
			break
		}
		buf := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range buf {
			ptrs[i] = &buf[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		row := &agentv1.QueryRow{
			Values: make([]string, len(cols)),
			Nulls:  make([]bool, len(cols)),
		}
		for i, v := range buf {
			if v == nil {
				row.Nulls[i] = true
				row.Values[i] = ""
				continue
			}
			row.Values[i] = sqlValueToString(v)
		}
		res.Rows = append(res.Rows, row)
		count++
	}
	if err := rows.Err(); err != nil {
		res.Success = false
		res.Error = sanitizeError(err.Error())
		return
	}
	res.Success = true
}

// buildSQLForOperation returns the SQL the agent should run plus whether it
// counts as a write (so we route through Exec vs Query). Operation == ""
// or "select" means run the user's query verbatim.
func buildSQLForOperation(driver string, cmd *agentv1.DatabaseQueryCommand) (string, bool, error) {
	op := strings.ToLower(strings.TrimSpace(cmd.Operation))
	switch op {
	case "", "select":
		// User query; write determined by write_mode + first keyword.
		isWrite := cmd.WriteMode
		kw := firstKeyword(cmd.Query)
		if _, isRead := sqlReadKeywords[kw]; isRead {
			isWrite = false
		}
		return cmd.Query, isWrite, nil
	case "list_schemas":
		switch driver {
		case "pgx":
			return "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name", false, nil
		case "mysql":
			return "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('mysql','information_schema','performance_schema','sys') ORDER BY schema_name", false, nil
		}
	case "list_tables":
		schema := cmd.Params["schema"]
		if !isSafeIdent(schema) {
			return "", false, errors.New("invalid schema name")
		}
		switch driver {
		case "pgx":
			return fmt.Sprintf("SELECT table_name FROM information_schema.tables WHERE table_schema = '%s' AND table_type IN ('BASE TABLE','VIEW') ORDER BY table_name", schema), false, nil
		case "mysql":
			return fmt.Sprintf("SELECT table_name FROM information_schema.tables WHERE table_schema = '%s' ORDER BY table_name", schema), false, nil
		}
	case "list_columns":
		schema := cmd.Params["schema"]
		table := cmd.Params["table"]
		if !isSafeIdent(schema) || !isSafeIdent(table) {
			return "", false, errors.New("invalid schema or table name")
		}
		switch driver {
		case "pgx":
			return fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '%s' AND table_name = '%s' ORDER BY ordinal_position", schema, table), false, nil
		case "mysql":
			return fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '%s' AND table_name = '%s' ORDER BY ordinal_position", schema, table), false, nil
		}
	case "get_rows":
		schema := cmd.Params["schema"]
		table := cmd.Params["table"]
		if !isSafeIdent(schema) || !isSafeIdent(table) {
			return "", false, errors.New("invalid schema or table name")
		}
		page, _ := strconv.Atoi(cmd.Params["page"])
		if page < 0 {
			page = 0
		}
		limit, _ := strconv.Atoi(cmd.Params["limit"])
		if limit <= 0 || limit > int(queryDefaultMaxRows) {
			limit = 100
		}
		offset := page * limit
		sortCol := cmd.Params["sort"]
		sortOrder := strings.ToUpper(cmd.Params["order"])
		if sortOrder != "ASC" && sortOrder != "DESC" {
			sortOrder = "ASC"
		}
		var orderClause string
		if sortCol != "" && isSafeIdent(sortCol) {
			switch driver {
			case "pgx":
				orderClause = fmt.Sprintf(` ORDER BY "%s" %s`, sortCol, sortOrder)
			case "mysql":
				orderClause = fmt.Sprintf(" ORDER BY `%s` %s", sortCol, sortOrder)
			}
		}
		switch driver {
		case "pgx":
			return fmt.Sprintf(`SELECT * FROM "%s"."%s"%s LIMIT %d OFFSET %d`, schema, table, orderClause, limit, offset), false, nil
		case "mysql":
			return fmt.Sprintf("SELECT * FROM `%s`.`%s`%s LIMIT %d OFFSET %d", schema, table, orderClause, limit, offset), false, nil
		}
	case "count_rows":
		schema := cmd.Params["schema"]
		table := cmd.Params["table"]
		if !isSafeIdent(schema) || !isSafeIdent(table) {
			return "", false, errors.New("invalid schema or table name")
		}
		switch driver {
		case "pgx":
			return fmt.Sprintf(`SELECT COUNT(*) FROM "%s"."%s"`, schema, table), false, nil
		case "mysql":
			return fmt.Sprintf("SELECT COUNT(*) FROM `%s`.`%s`", schema, table), false, nil
		}
	}
	return "", false, fmt.Errorf("unknown operation %q for driver %q", op, driver)
}

// isSafeIdent allows simple identifier characters only. Used to gate
// dynamically-built schema/table/column names — never user data.
func isSafeIdent(s string) bool {
	if s == "" || len(s) > 63 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r == '_':
		case i > 0 && (r >= '0' && r <= '9'):
		default:
			return false
		}
	}
	return true
}

// sqlValueToString converts a scanned column value to its string representation.
func sqlValueToString(v interface{}) string {
	switch val := v.(type) {
	case nil:
		return ""
	case []byte:
		return string(val)
	case string:
		return val
	case time.Time:
		return val.Format(time.RFC3339)
	case bool:
		if val {
			return "true"
		}
		return "false"
	case int64:
		return strconv.FormatInt(val, 10)
	case int32:
		return strconv.FormatInt(int64(val), 10)
	case int:
		return strconv.Itoa(val)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(val), 'f', -1, 32)
	default:
		return fmt.Sprintf("%v", val)
	}
}

// --- MongoDB ---

func runMongoQuery(ctx context.Context, cmd *agentv1.DatabaseQueryCommand, res *agentv1.DatabaseQueryResult, maxRows int64) {
	host := resolveDBHost(cmd)
	port := cmd.Port
	if port == 0 {
		port = 27017
	}
	// app_user is created on the application database (see post-init), so we
	// authenticate against that database. Backups still use authSource=admin
	// because they auth as the root user — they take a different path.
	authSource := "admin"
	if cmd.Dbname != "" {
		authSource = cmd.Dbname
	}
	uri := fmt.Sprintf("mongodb://%s:%s@%s:%d", url.QueryEscape(cmd.Username), url.QueryEscape(cmd.Password), host, port)
	if cmd.Dbname != "" {
		uri += "/" + cmd.Dbname + "?authSource=" + url.QueryEscape(authSource)
	} else {
		uri += "/?authSource=" + url.QueryEscape(authSource)
	}

	clientOpts := options.Client().ApplyURI(uri)
	if cmd.TimeoutSeconds > 0 {
		clientOpts.SetServerSelectionTimeout(time.Duration(cmd.TimeoutSeconds) * time.Second)
		clientOpts.SetConnectTimeout(time.Duration(cmd.TimeoutSeconds) * time.Second)
	}

	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		res.Success = false
		res.Error = "connect: " + sanitizeError(err.Error())
		return
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	dbName := cmd.Dbname
	if dbName == "" {
		dbName = "admin"
	}
	mongoDB := client.Database(dbName)

	op := strings.ToLower(strings.TrimSpace(cmd.Operation))
	switch op {
	case "", "mongo_list_collections":
		colls, err := mongoDB.ListCollectionNames(ctx, bson.D{})
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		b, _ := json.Marshal(colls)
		res.RawText = string(b)
		res.Success = true
	case "mongo_find":
		coll := cmd.Params["collection"]
		if coll == "" {
			res.Success = false
			res.Error = "params.collection is required"
			return
		}
		filter := bson.M{}
		if f := strings.TrimSpace(cmd.Params["filter"]); f != "" && f != "{}" {
			if err := bson.UnmarshalExtJSON([]byte(f), false, &filter); err != nil {
				res.Success = false
				res.Error = "invalid filter JSON: " + err.Error()
				return
			}
		}
		findOpts := options.Find()
		if l, _ := strconv.ParseInt(cmd.Params["limit"], 10, 64); l > 0 {
			if l > maxRows {
				l = maxRows
			}
			findOpts.SetLimit(l)
		} else {
			findOpts.SetLimit(maxRows)
		}
		if s, _ := strconv.ParseInt(cmd.Params["skip"], 10, 64); s > 0 {
			findOpts.SetSkip(s)
		}
		cur, err := mongoDB.Collection(coll).Find(ctx, filter, findOpts)
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		defer cur.Close(ctx)
		var docs []bson.M
		if err := cur.All(ctx, &docs); err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		b, err := bson.MarshalExtJSON(bson.M{"docs": docs}, false, false)
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		res.RawText = string(b)
		res.Success = true
	case "mongo_get_doc":
		coll := cmd.Params["collection"]
		idStr := cmd.Params["id"]
		if coll == "" || idStr == "" {
			res.Success = false
			res.Error = "params.collection and params.id are required"
			return
		}
		var doc bson.M
		err := mongoDB.Collection(coll).FindOne(ctx, bson.M{"_id": idStr}).Decode(&doc)
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		b, err := bson.MarshalExtJSON(doc, false, false)
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		res.RawText = string(b)
		res.Success = true
	default:
		res.Success = false
		res.Error = "unknown mongo operation: " + cmd.Operation
	}
}

// --- Redis ---

func runRedisQuery(ctx context.Context, cmd *agentv1.DatabaseQueryCommand, res *agentv1.DatabaseQueryResult, maxRows int64) {
	host := resolveDBHost(cmd)
	port := cmd.Port
	if port == 0 {
		port = 6379
	}
	// On Redis 6+ we provision a scoped "app_user" via ACL post-init, so we
	// connect with both Username and Password. On older Redis the username
	// is ignored by the server and Password (requirepass) is what counts.
	rdb := redis.NewClient(&redis.Options{
		Addr:        fmt.Sprintf("%s:%d", host, port),
		Username:    cmd.Username,
		Password:    cmd.Password,
		DB:          0,
		DialTimeout: 5 * time.Second,
		ReadTimeout: time.Duration(cmd.TimeoutSeconds) * time.Second,
	})
	defer rdb.Close()

	op := strings.ToLower(strings.TrimSpace(cmd.Operation))
	switch op {
	case "redis_keys":
		pattern := cmd.Params["pattern"]
		if pattern == "" {
			pattern = "*"
		}
		cursor := uint64(0)
		if c, err := strconv.ParseUint(cmd.Params["cursor"], 10, 64); err == nil {
			cursor = c
		}
		count := int64(100)
		if c, err := strconv.ParseInt(cmd.Params["count"], 10, 64); err == nil && c > 0 {
			count = c
		}
		if count > maxRows {
			count = maxRows
		}
		keys, nextCursor, err := rdb.Scan(ctx, cursor, pattern, count).Result()
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		payload, _ := json.Marshal(map[string]any{
			"keys":        keys,
			"next_cursor": nextCursor,
		})
		res.RawText = string(payload)
		res.Success = true
	case "redis_type":
		key := cmd.Params["key"]
		if key == "" {
			res.Success = false
			res.Error = "params.key is required"
			return
		}
		t, err := rdb.Type(ctx, key).Result()
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		res.RawText = t
		res.Success = true
	case "redis_ttl":
		key := cmd.Params["key"]
		if key == "" {
			res.Success = false
			res.Error = "params.key is required"
			return
		}
		ttl, err := rdb.TTL(ctx, key).Result()
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		payload, _ := json.Marshal(map[string]any{"ttl_seconds": int64(ttl.Seconds())})
		res.RawText = string(payload)
		res.Success = true
	case "redis_get":
		key := cmd.Params["key"]
		if key == "" {
			res.Success = false
			res.Error = "params.key is required"
			return
		}
		t, err := rdb.Type(ctx, key).Result()
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		out := map[string]any{"type": t, "key": key}
		ttl, _ := rdb.TTL(ctx, key).Result()
		out["ttl_seconds"] = int64(ttl.Seconds())
		switch t {
		case "string":
			v, err := rdb.Get(ctx, key).Result()
			if err != nil && err != redis.Nil {
				res.Success = false
				res.Error = sanitizeError(err.Error())
				return
			}
			out["value"] = v
		case "list":
			v, err := rdb.LRange(ctx, key, 0, maxRows-1).Result()
			if err != nil {
				res.Success = false
				res.Error = sanitizeError(err.Error())
				return
			}
			out["value"] = v
		case "set":
			v, err := rdb.SMembers(ctx, key).Result()
			if err != nil {
				res.Success = false
				res.Error = sanitizeError(err.Error())
				return
			}
			out["value"] = v
		case "hash":
			v, err := rdb.HGetAll(ctx, key).Result()
			if err != nil {
				res.Success = false
				res.Error = sanitizeError(err.Error())
				return
			}
			out["value"] = v
		case "zset":
			v, err := rdb.ZRangeWithScores(ctx, key, 0, maxRows-1).Result()
			if err != nil {
				res.Success = false
				res.Error = sanitizeError(err.Error())
				return
			}
			out["value"] = v
		case "stream":
			v, err := rdb.XRange(ctx, key, "-", "+").Result()
			if err != nil {
				res.Success = false
				res.Error = sanitizeError(err.Error())
				return
			}
			out["value"] = v
		default:
			out["value"] = nil
		}
		b, _ := json.Marshal(out)
		res.RawText = string(b)
		res.Success = true
	case "redis_info":
		section := cmd.Params["section"]
		var info string
		var err error
		if section != "" {
			info, err = rdb.Info(ctx, section).Result()
		} else {
			info, err = rdb.Info(ctx).Result()
		}
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		res.RawText = info
		res.Success = true
	case "redis_config":
		pattern := cmd.Params["pattern"]
		if pattern == "" {
			pattern = "*"
		}
		conf, err := rdb.ConfigGet(ctx, pattern).Result()
		if err != nil {
			res.Success = false
			res.Error = sanitizeError(err.Error())
			return
		}
		b, _ := json.Marshal(conf)
		res.RawText = string(b)
		res.Success = true
	default:
		res.Success = false
		res.Error = "unknown redis operation: " + cmd.Operation
	}
}

// --- Helpers ---

func sendDatabaseQueryResult(stream agentv1.AgentService_ConnectClient, res *agentv1.DatabaseQueryResult) {
	_ = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_DatabaseQueryResult{DatabaseQueryResult: res},
	})
}

// sanitizeError trims and length-bounds a driver error so we don't leak stack
// traces or huge backend dumps. Passwords arriving in DSNs are also stripped
// just in case the driver echoed them.
func sanitizeError(msg string) string {
	msg = strings.TrimSpace(msg)
	// Best-effort scrub of password fragments embedded in DSNs.
	if i := strings.Index(msg, ":/"); i >= 0 {
		// Look for the userinfo portion and replace pwd with ***.
		if at := strings.Index(msg, "@"); at > i {
			before := msg[:i+3] // up to "://"
			after := msg[at:]
			msg = before + "***" + after
		}
	}
	if len(msg) > 512 {
		msg = msg[:512] + "...(truncated)"
	}
	return msg
}
