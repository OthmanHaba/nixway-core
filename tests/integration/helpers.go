package integration

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/othmanhaba/nixway-core/internal/api"
	appsvc "github.com/othmanhaba/nixway-core/internal/app"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/agent"
	"github.com/othmanhaba/nixway-core/internal/build"
	"github.com/othmanhaba/nixway-core/internal/cluster"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/containerlog"
	"github.com/othmanhaba/nixway-core/internal/deploy"
	githubsvc "github.com/othmanhaba/nixway-core/internal/github"
	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/othmanhaba/nixway-core/internal/project"
	"github.com/othmanhaba/nixway-core/internal/provisioner"
	"github.com/othmanhaba/nixway-core/internal/secret"
	internalredis "github.com/othmanhaba/nixway-core/internal/redis"
	"github.com/othmanhaba/nixway-core/internal/server"
	"github.com/redis/go-redis/v9"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestEnv holds all dependencies for integration tests.
type TestEnv struct {
	T           *testing.T
	Ctx         context.Context
	Pool        *pgxpool.Pool
	Queries     *db.Queries
	RedisClient *redis.Client
	Server      *httptest.Server
	Client      *http.Client
	Logger      *slog.Logger
	Config      *config.Config
	MasterKey   [32]byte
	transport   http.RoundTripper // TLS transport that trusts the test server cert
}

// SetupTestEnv creates a full test environment with Postgres, Redis,
// migrations applied, and the API server running on httptest.
func SetupTestEnv(t *testing.T) *TestEnv {
	t.Helper()
	ctx := context.Background()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))

	// --- Start Postgres ---
	pgC, err := postgres.Run(ctx,
		"postgres:16-alpine",
		postgres.WithDatabase("nixway_test"),
		postgres.WithUsername("nixway"),
		postgres.WithPassword("nixway"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = pgC.Terminate(context.Background())
	})

	pgURL, err := pgC.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	// --- Start Redis ---
	redisC, err := tcredis.Run(ctx, "redis:7-alpine",
		testcontainers.WithWaitStrategy(
			wait.ForLog("Ready to accept connections").
				WithStartupTimeout(30*time.Second),
		),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = redisC.Terminate(context.Background())
	})

	redisURL, err := redisC.ConnectionString(ctx)
	require.NoError(t, err)

	// --- Connect to Postgres ---
	pool, err := pgxpool.New(ctx, pgURL)
	require.NoError(t, err)
	t.Cleanup(func() {
		pool.Close()
	})

	// --- Run migrations ---
	migrationSQL, err := os.ReadFile("../../sql/migrations/00001_initial_schema.sql")
	require.NoError(t, err)
	upSQL := extractGooseUp(string(migrationSQL))
	_, err = pool.Exec(ctx, upSQL)
	require.NoError(t, err)

	migration2SQL, err := os.ReadFile("../../sql/migrations/00002_server_management.sql")
	require.NoError(t, err)
	upSQL2 := extractGooseUp(string(migration2SQL))
	_, err = pool.Exec(ctx, upSQL2)
	require.NoError(t, err)

	migration3SQL, err := os.ReadFile("../../sql/migrations/00003_clusters_networking.sql")
	require.NoError(t, err)
	upSQL3 := extractGooseUp(string(migration3SQL))
	_, err = pool.Exec(ctx, upSQL3)
	require.NoError(t, err)

	migration4SQL, err := os.ReadFile("../../sql/migrations/00004_integrations.sql")
	require.NoError(t, err)
	upSQL4 := extractGooseUp(string(migration4SQL))
	_, err = pool.Exec(ctx, upSQL4)
	require.NoError(t, err)

	migration5SQL, err := os.ReadFile("../../sql/migrations/00005_projects_deployments.sql")
	require.NoError(t, err)
	upSQL5 := extractGooseUp(string(migration5SQL))
	_, err = pool.Exec(ctx, upSQL5)
	require.NoError(t, err)

	migration6SQL, err := os.ReadFile("../../sql/migrations/00006_deploy_logs_domain.sql")
	require.NoError(t, err)
	upSQL6 := extractGooseUp(string(migration6SQL))
	_, err = pool.Exec(ctx, upSQL6)
	require.NoError(t, err)

	// --- Run River migrations ---
	riverMigrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	require.NoError(t, err)
	_, err = riverMigrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	require.NoError(t, err)

	// --- Build dependencies ---
	queries := db.New(pool)

	redisClient, err := internalredis.NewClient(ctx, redisURL)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = redisClient.Close()
	})

	sessionStore := internalredis.NewSessionStore(redisClient)
	sessionMgr := auth.NewSessionManager(sessionStore, 24*time.Hour)
	emailSender := email.NewConsoleSender(logger)
	auditWriter := audit.NewWriter(queries)

	cfg := &config.Config{
		Server: config.ServerConfig{Host: "0.0.0.0", Port: 8080},
		Database: config.DatabaseConfig{URL: pgURL},
		Redis:    config.RedisConfig{URL: redisURL},
		Auth: config.AuthConfig{
			SessionTTL:       24 * time.Hour,
			BcryptCost:       4, // Low cost for fast tests
			TokenLength:      40,
			VerifyEmailTTL:   24 * time.Hour,
			PasswordResetTTL: 1 * time.Hour,
			InviteTTL:        168 * time.Hour,
		},
		Email: config.EmailConfig{
			Driver:  "console",
			From:    "noreply@nixway.dev",
			BaseURL: "http://localhost:5173",
		},
	}

	// --- Generate master key for SSH key encryption ---
	var masterKey [32]byte
	_, err = rand.Read(masterKey[:])
	require.NoError(t, err)

	onboardingSvc := server.NewOnboardingService(queries, logger, masterKey, "http://localhost:8080", "localhost:9090")

	// --- Provisioning service ---
	provisionSvc := provisioner.NewService(queries, redisClient, logger, masterKey, "http://localhost:8080", "localhost:9090")

	// --- Cluster service ---
	clusterSvc := cluster.NewService(queries, "10.100.0.0/10", logger)

	// --- Mesh manager ---
	connMgr := agent.NewConnManager(logger)
	meshMgr := mesh.NewManager(queries, connMgr, redisClient, logger)

	// --- GitHub App service ---
	githubService := githubsvc.NewService("https://github.com", "https://api.github.com", "http://localhost:8080", "http://localhost:5173", logger)

	// --- Secrets service ---
	secretSvc := secret.NewService(queries, masterKey, logger)

	// --- Project & App services ---
	projectSvc := project.NewService(queries, logger)
	appService := appsvc.NewService(queries, logger)
	buildSvc := build.NewService(queries, redisClient, connMgr, githubService, masterKey, logger)
	deploySvc := deploy.NewService(queries, redisClient, connMgr, secretSvc, logger)

	// --- Create API router and test server ---
	// Use TLS server so that Secure cookies are preserved by the cookie jar.
	containerLogSvc := containerlog.NewService(queries, logger)
	router := api.NewRouter(queries, sessionMgr, emailSender, auditWriter, cfg, logger, redisClient, masterKey, onboardingSvc, provisionSvc, clusterSvc, connMgr, meshMgr, githubService, secretSvc, projectSvc, appService, buildSvc, deploySvc, containerLogSvc)
	ts := httptest.NewTLSServer(router)
	t.Cleanup(func() {
		ts.Close()
	})

	// --- HTTP client with cookie jar ---
	// Use the TLS-configured client from the test server (trusts its self-signed cert),
	// but attach a cookie jar.
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	tlsClient := ts.Client()
	transport := tlsClient.Transport
	client := &http.Client{
		Jar:       jar,
		Timeout:   10 * time.Second,
		Transport: transport,
	}

	return &TestEnv{
		T:           t,
		Ctx:         ctx,
		Pool:        pool,
		Queries:     queries,
		RedisClient: redisClient,
		Server:      ts,
		Client:      client,
		Logger:      logger,
		Config:      cfg,
		MasterKey:   masterKey,
		transport:   transport,
	}
}

// NewClientWithJar creates a new HTTP client with its own cookie jar,
// useful for simulating a second user session.
func (e *TestEnv) NewClientWithJar() *http.Client {
	jar, err := cookiejar.New(nil)
	require.NoError(e.T, err)
	return &http.Client{
		Jar:       jar,
		Timeout:   10 * time.Second,
		Transport: e.transport,
	}
}

// Post sends a POST request with JSON body using the default client.
func (e *TestEnv) Post(path string, body any) *http.Response {
	return e.PostWith(e.Client, path, body)
}

// Get sends a GET request using the default client.
func (e *TestEnv) Get(path string) *http.Response {
	return e.GetWith(e.Client, path)
}

// Delete sends a DELETE request using the default client.
func (e *TestEnv) Delete(path string) *http.Response {
	return e.DeleteWith(e.Client, path)
}

// PostWith sends a POST request with JSON body using the given client.
func (e *TestEnv) PostWith(client *http.Client, path string, body any) *http.Response {
	e.T.Helper()
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(e.T, err)
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodPost, e.Server.URL+path, bodyReader)
	require.NoError(e.T, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	require.NoError(e.T, err)
	return resp
}

// GetWith sends a GET request using the given client.
func (e *TestEnv) GetWith(client *http.Client, path string) *http.Response {
	e.T.Helper()
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodGet, e.Server.URL+path, nil)
	require.NoError(e.T, err)
	resp, err := client.Do(req)
	require.NoError(e.T, err)
	return resp
}

// DeleteWith sends a DELETE request using the given client.
func (e *TestEnv) DeleteWith(client *http.Client, path string) *http.Response {
	e.T.Helper()
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodDelete, e.Server.URL+path, nil)
	require.NoError(e.T, err)
	resp, err := client.Do(req)
	require.NoError(e.T, err)
	return resp
}

// Put sends a PUT request with JSON body using the default client.
func (e *TestEnv) Put(path string, body any) *http.Response {
	e.T.Helper()
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(e.T, err)
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodPut, e.Server.URL+path, bodyReader)
	require.NoError(e.T, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := e.Client.Do(req)
	require.NoError(e.T, err)
	return resp
}

// PostWithToken sends a POST request with a Bearer token.
func (e *TestEnv) PostWithToken(path string, body any, token string) *http.Response {
	e.T.Helper()
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(e.T, err)
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodPost, e.Server.URL+path, bodyReader)
	require.NoError(e.T, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	tokenClient := &http.Client{Transport: e.transport, Timeout: 10 * time.Second}
	resp, err := tokenClient.Do(req)
	require.NoError(e.T, err)
	return resp
}

// GetWithToken sends a GET request with a Bearer token.
func (e *TestEnv) GetWithToken(path string, token string) *http.Response {
	e.T.Helper()
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodGet, e.Server.URL+path, nil)
	require.NoError(e.T, err)
	req.Header.Set("Authorization", "Bearer "+token)
	tokenClient := &http.Client{Transport: e.transport, Timeout: 10 * time.Second}
	resp, err := tokenClient.Do(req)
	require.NoError(e.T, err)
	return resp
}

// DeleteWithToken sends a DELETE request with a Bearer token.
func (e *TestEnv) DeleteWithToken(path string, token string) *http.Response {
	e.T.Helper()
	req, err := http.NewRequestWithContext(e.Ctx, http.MethodDelete, e.Server.URL+path, nil)
	require.NoError(e.T, err)
	req.Header.Set("Authorization", "Bearer "+token)
	tokenClient := &http.Client{Transport: e.transport, Timeout: 10 * time.Second}
	resp, err := tokenClient.Do(req)
	require.NoError(e.T, err)
	return resp
}

// ReadJSON decodes the response body into the target value.
func ReadJSON(t *testing.T, resp *http.Response, target any) {
	t.Helper()
	defer resp.Body.Close()
	err := json.NewDecoder(resp.Body).Decode(target)
	require.NoError(t, err)
}

// ReadJSONMap reads the response body as a generic JSON map.
func ReadJSONMap(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var m map[string]any
	ReadJSON(t, resp, &m)
	return m
}

// extractGooseUp extracts the SQL between "-- +goose Up" and "-- +goose Down".
func extractGooseUp(sql string) string {
	const upMarker = "-- +goose Up"
	const downMarker = "-- +goose Down"
	start := 0
	if idx := indexOf(sql, upMarker); idx >= 0 {
		start = idx + len(upMarker)
	}
	end := len(sql)
	if idx := indexOf(sql, downMarker); idx >= 0 {
		end = idx
	}
	return sql[start:end]
}

func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}


// SignupAndLogin is a convenience helper that signs up a user, verifies email,
// and logs in, returning the user ID. Uses the provided HTTP client.
func (e *TestEnv) SignupAndLogin(client *http.Client, eml, password, name string) string {
	e.T.Helper()

	// Sign up
	resp := e.PostWith(client, "/api/v1/auth/signup", map[string]string{
		"email": eml, "password": password, "name": name,
	})
	require.Equal(e.T, http.StatusCreated, resp.StatusCode,
		"signup should return 201, got %d", resp.StatusCode)
	signupData := ReadJSONMap(e.T, resp)
	userID := signupData["id"].(string)

	// Get verify token from DB
	user, err := e.Queries.GetUserByEmail(e.Ctx, eml)
	require.NoError(e.T, err)
	require.NotNil(e.T, user.EmailVerifyToken)

	// Verify email
	resp = e.PostWith(client, "/api/v1/auth/verify-email", map[string]string{
		"token": *user.EmailVerifyToken,
	})
	require.Equal(e.T, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Login
	resp = e.PostWith(client, "/api/v1/auth/login", map[string]string{
		"email": eml, "password": password,
	})
	require.Equal(e.T, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	return userID
}

// CreateTeamAsUser creates a team using the provided client (must be logged in).
// Returns the team ID.
func (e *TestEnv) CreateTeamAsUser(client *http.Client, teamName string) string {
	e.T.Helper()
	resp := e.PostWith(client, "/api/v1/teams", map[string]string{"name": teamName})
	require.Equal(e.T, http.StatusCreated, resp.StatusCode,
		fmt.Sprintf("create team should return 201, got %d", resp.StatusCode))
	data := ReadJSONMap(e.T, resp)
	return data["id"].(string)
}
