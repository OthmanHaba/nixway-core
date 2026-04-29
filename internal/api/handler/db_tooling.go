package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/database"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/template"
)

// DBToolingHandler exposes the database tooling UI: terminal, table browser,
// query runner, redis inspector, mongo browser, and saved-query store.
//
// All routes are scoped to /databases/{databaseId}/... and verify the user
// has access via the team membership chain (project -> team -> user).
type DBToolingHandler struct {
	queries     *db.Queries
	databaseSvc *database.Service
	connMgr     *agent.ConnManager
	redis       *redis.Client
	templateReg *template.Registry
	audit       *audit.Writer
	logger      *slog.Logger
}

func NewDBToolingHandler(
	queries *db.Queries,
	databaseSvc *database.Service,
	connMgr *agent.ConnManager,
	redisClient *redis.Client,
	templateReg *template.Registry,
	auditWriter *audit.Writer,
	logger *slog.Logger,
) *DBToolingHandler {
	return &DBToolingHandler{
		queries:     queries,
		databaseSvc: databaseSvc,
		connMgr:     connMgr,
		redis:       redisClient,
		templateReg: templateReg,
		audit:       auditWriter,
		logger:      logger,
	}
}

// requireDatabase loads the database, verifies the requester has access
// via the team membership chain, and returns the row + user ID.
func (h *DBToolingHandler) requireDatabase(w http.ResponseWriter, r *http.Request) (db.Database, uuid.UUID, bool) {
	auth := middleware.GetAuthContext(r)
	if auth == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return db.Database{}, uuid.Nil, false
	}
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return db.Database{}, uuid.Nil, false
	}
	d, err := h.databaseSvc.Get(r.Context(), dbID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respond.Error(w, http.StatusNotFound, "database not found")
			return db.Database{}, uuid.Nil, false
		}
		respond.Error(w, http.StatusInternalServerError, "failed to load database")
		return db.Database{}, uuid.Nil, false
	}
	// Verify the user is a member of the database's team.
	if _, err := h.queries.GetMembership(r.Context(), db.GetMembershipParams{
		TeamID: d.TeamID,
		UserID: auth.UserID,
	}); err != nil {
		respond.Error(w, http.StatusNotFound, "database not found")
		return db.Database{}, uuid.Nil, false
	}
	return d, auth.UserID, true
}

// ListSchemas handles GET /api/v1/databases/{databaseId}/schemas
func (h *DBToolingHandler) ListSchemas(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	out, err := h.databaseSvc.ListSchemas(r.Context(), userID, d.ID)
	if err != nil {
		h.logger.Warn("list schemas failed", "database_id", d.ID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, out)
}

// ListTables handles GET /api/v1/databases/{databaseId}/schemas/{schema}/tables
func (h *DBToolingHandler) ListTables(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	schema := r.PathValue("schema")
	out, err := h.databaseSvc.ListTables(r.Context(), userID, d.ID, schema)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, out)
}

// GetTableRows handles GET /api/v1/databases/{databaseId}/schemas/{schema}/tables/{table}
// Query params: page (int, default 0), limit (int, default 100), sort (column),
// order (ASC|DESC, default ASC).
func (h *DBToolingHandler) GetTableRows(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	schema := r.PathValue("schema")
	table := r.PathValue("table")
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	sort := q.Get("sort")
	order := q.Get("order")
	out, err := h.databaseSvc.GetTableRows(r.Context(), userID, d.ID, schema, table, page, limit, sort, order)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, out)
}

type runQueryRequest struct {
	SQL       string `json:"sql"`
	WriteMode bool   `json:"write_mode"`
}

// RunQuery handles POST /api/v1/databases/{databaseId}/query
// Body: { "sql": string, "write_mode": bool }
func (h *DBToolingHandler) RunQuery(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	var req runQueryRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	res, err := h.databaseSvc.ExecuteQuery(r.Context(), database.QueryRequest{
		DatabaseID: d.ID,
		UserID:     userID,
		Query:      req.SQL,
		WriteMode:  req.WriteMode,
	})
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if h.audit != nil {
		execMS := int64(0)
		rowCount := 0
		if res != nil {
			execMS = res.ExecutionTimeMS
			rowCount = len(res.Rows)
			if rowCount == 0 && res.AffectedRows > 0 {
				rowCount = res.AffectedRows
			}
		}
		errMsg := ""
		success := false
		if res != nil {
			errMsg = res.Error
			success = res.Success
		}
		if err := h.audit.WriteDatabaseQueryExecuted(r.Context(), d.TeamID, userID, d.ID, req.SQL, req.WriteMode, rowCount, execMS, success, errMsg); err != nil {
			h.logger.Warn("audit write_database_query_executed failed", "error", err)
		}
	}
	respond.JSON(w, http.StatusOK, res)
}

// ListQueryHistory handles GET /api/v1/databases/{databaseId}/query/history
// Query params: limit (int, default 50, max 200).
func (h *DBToolingHandler) ListQueryHistory(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	hist, err := h.databaseSvc.ListQueryHistory(r.Context(), userID, d.ID, limit)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list history")
		return
	}
	respond.JSON(w, http.StatusOK, hist)
}

type saveQueryRequest struct {
	Name      string `json:"name"`
	QueryText string `json:"query_text"`
}

// SaveQuery handles POST /api/v1/databases/{databaseId}/query/save
// Body: { "name": string, "query_text": string }
func (h *DBToolingHandler) SaveQuery(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	var req saveQueryRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.QueryText == "" {
		respond.Error(w, http.StatusBadRequest, "name and query_text are required")
		return
	}
	saved, err := h.databaseSvc.CreateSavedQuery(r.Context(), d.ProjectID, userID, d.ID, req.Name, req.QueryText)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, saved)
}

// ListSavedQueriesByProject handles GET /api/v1/projects/{projectId}/saved-queries
func (h *DBToolingHandler) ListSavedQueriesByProject(w http.ResponseWriter, r *http.Request) {
	auth := middleware.GetAuthContext(r)
	if auth == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}
	project, err := h.queries.GetProject(r.Context(), projectID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "project not found")
		return
	}
	if _, err := h.queries.GetMembership(r.Context(), db.GetMembershipParams{
		TeamID: project.TeamID,
		UserID: auth.UserID,
	}); err != nil {
		respond.Error(w, http.StatusNotFound, "project not found")
		return
	}
	out, err := h.databaseSvc.ListSavedQueriesByProject(r.Context(), projectID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list saved queries")
		return
	}
	respond.JSON(w, http.StatusOK, out)
}

// --- Redis ---

// RedisListKeys handles GET /api/v1/databases/{databaseId}/redis/keys
// Query: pattern, cursor, count.
func (h *DBToolingHandler) RedisListKeys(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	count, _ := strconv.Atoi(q.Get("count"))
	res, err := h.databaseSvc.RedisListKeys(r.Context(), userID, d.ID, q.Get("pattern"), q.Get("cursor"), count)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// RedisGetKey handles GET /api/v1/databases/{databaseId}/redis/key?key=...
func (h *DBToolingHandler) RedisGetKey(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		respond.Error(w, http.StatusBadRequest, "key query parameter required")
		return
	}
	res, err := h.databaseSvc.RedisGetKey(r.Context(), userID, d.ID, key)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// RedisInfo handles GET /api/v1/databases/{databaseId}/redis/info
func (h *DBToolingHandler) RedisInfo(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	section := r.URL.Query().Get("section")
	res, err := h.databaseSvc.RedisInfo(r.Context(), userID, d.ID, section)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// RedisConfig handles GET /api/v1/databases/{databaseId}/redis/config
func (h *DBToolingHandler) RedisConfig(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	res, err := h.databaseSvc.RedisConfig(r.Context(), userID, d.ID, r.URL.Query().Get("pattern"))
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// --- Mongo ---

// MongoListCollections handles GET /api/v1/databases/{databaseId}/mongo/collections
func (h *DBToolingHandler) MongoListCollections(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	res, err := h.databaseSvc.MongoListCollections(r.Context(), userID, d.ID)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// MongoFind handles GET /api/v1/databases/{databaseId}/mongo/collections/{collection}/find
// Query: filter (JSON), limit, skip.
func (h *DBToolingHandler) MongoFind(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	coll := r.PathValue("collection")
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	skip, _ := strconv.Atoi(q.Get("skip"))
	res, err := h.databaseSvc.MongoFind(r.Context(), userID, d.ID, coll, q.Get("filter"), limit, skip)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// MongoGetDocument handles GET /api/v1/databases/{databaseId}/mongo/collections/{collection}/doc?id=...
func (h *DBToolingHandler) MongoGetDocument(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	coll := r.PathValue("collection")
	id := r.URL.Query().Get("id")
	if id == "" {
		respond.Error(w, http.StatusBadRequest, "id query parameter required")
		return
	}
	res, err := h.databaseSvc.MongoGetDocument(r.Context(), userID, d.ID, coll, id)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, res)
}

// --- Terminal (WebSocket; reuses Phase 5 container exec) ---

// Terminal handles GET /api/v1/databases/{databaseId}/terminal — opens a
// WebSocket-bridged interactive shell against the database container using
// the existing ContainerExec relay. Shell command comes from the template.
func (h *DBToolingHandler) Terminal(w http.ResponseWriter, r *http.Request) {
	d, userID, ok := h.requireDatabase(w, r)
	if !ok {
		return
	}
	tmpl, found := h.templateReg.Get(d.TemplateSlug)
	if !found || tmpl.ShellCommand == "" {
		http.Error(w, "no shell available for this database type", http.StatusUnprocessableEntity)
		return
	}

	// Resolve agent.
	srv, err := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{ID: d.ServerID, TeamID: d.TeamID})
	if err != nil || srv.AgentID == nil || *srv.AgentID == "" {
		http.Error(w, "agent not available", http.StatusServiceUnavailable)
		return
	}

	// Upgrade to WebSocket.
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("db terminal: websocket upgrade failed", "error", err)
		return
	}
	defer ws.Close()

	sessionID := uuid.New().String()
	channel := "exec:" + sessionID
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	// Build the shell command we'll exec inside the container.
	shellCmd := tmpl.ShellCommand
	switch tmpl.ShellCommand {
	case "psql":
		shellCmd = "psql -U postgres"
	case "mysql":
		shellCmd = "mysql -uroot"
	case "mongosh":
		shellCmd = "mongosh"
	case "redis-cli":
		shellCmd = "redis-cli"
	}

	if err := h.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ContainerExec{
			ContainerExec: &agentv1.ContainerExecCommand{
				SessionId:     sessionID,
				ContainerName: d.ContainerName,
				Command:       shellCmd,
				Cols:          120,
				Rows:          40,
			},
		},
	}); err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("failed to start exec session: "+err.Error()))
		return
	}

	h.logger.Info("db terminal session started",
		"session_id", sessionID,
		"database_id", d.ID,
		"container", d.ContainerName,
		"shell", shellCmd,
		"user_id", userID,
	)

	// Redis exec output -> WebSocket
	go func() {
		ch := sub.Channel()
		for msg := range ch {
			if msg.Payload == "__done__" {
				_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\nSession ended.\r\n"))
				_ = ws.Close()
				return
			}
			_ = ws.WriteMessage(websocket.BinaryMessage, []byte(msg.Payload))
		}
	}()

	// WebSocket -> Agent exec input
	for {
		_, message, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var msg wsMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			h.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
				Payload: &agentv1.ControlMessage_ContainerExecInput{
					ContainerExecInput: &agentv1.ContainerExecInput{
						SessionId: sessionID,
						Data:      message,
					},
				},
			})
			continue
		}
		switch msg.Type {
		case "input":
			h.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
				Payload: &agentv1.ControlMessage_ContainerExecInput{
					ContainerExecInput: &agentv1.ContainerExecInput{
						SessionId: sessionID,
						Data:      []byte(msg.Data),
					},
				},
			})
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				h.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
					Payload: &agentv1.ControlMessage_ContainerExecInput{
						ContainerExecInput: &agentv1.ContainerExecInput{
							SessionId: sessionID,
							Cols:      int32(msg.Cols),
							Rows:      int32(msg.Rows),
						},
					},
				})
			}
		}
	}

	// Close exec session on agent.
	h.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ContainerExecInput{
			ContainerExecInput: &agentv1.ContainerExecInput{
				SessionId: sessionID,
				Close:     true,
			},
		},
	})
	h.logger.Info("db terminal session ended", "session_id", sessionID, "database_id", d.ID)
	_ = fmt.Sprint("") // silence unused fmt when no errors
}
