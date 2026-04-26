package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"

	"google.golang.org/grpc"

	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/api"
	appsvc "github.com/othmanhaba/nixway-core/internal/app"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/build"
	"github.com/othmanhaba/nixway-core/internal/cluster"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/containerlog"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/deploy"
	"github.com/othmanhaba/nixway-core/internal/email"
	githubsvc "github.com/othmanhaba/nixway-core/internal/github"
	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/othmanhaba/nixway-core/internal/observability"
	"github.com/othmanhaba/nixway-core/internal/project"
	"github.com/othmanhaba/nixway-core/internal/provisioner"
	nixredis "github.com/othmanhaba/nixway-core/internal/redis"
	"github.com/othmanhaba/nixway-core/internal/secret"
	"github.com/othmanhaba/nixway-core/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	ctx := context.Background()

	// Database
	pool, err := db.NewPool(ctx, cfg.Database.URL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	queries := db.New(pool)

	// Redis
	redisClient, err := nixredis.NewClient(ctx, cfg.Redis.URL)
	if err != nil {
		logger.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	sessionStore := nixredis.NewSessionStore(redisClient)
	sessions := auth.NewSessionManager(sessionStore, cfg.Auth.SessionTTL)

	// Email
	var emailSender email.Sender
	switch cfg.Email.Driver {
	case "smtp":
		emailSender = email.NewSMTPSender(
			cfg.Email.SMTPHost,
			cfg.Email.SMTPPort,
			cfg.Email.SMTPUser,
			cfg.Email.SMTPPass,
			cfg.Email.From,
		)
	default:
		emailSender = email.NewConsoleSender(logger)
	}

	// Audit
	auditWriter := audit.NewWriter(queries)

	// Master key (required)
	var masterKey [32]byte
	if cfg.Crypto.MasterKey == "" {
		logger.Error("NIXWAY_CRYPTO_MASTER_KEY is required. Generate one with: python3 -c \"import secrets; print(secrets.token_hex(32))\" and add it to .env")
		os.Exit(1)
	}
	masterKey, err = crypto.MasterKeyFromHex(cfg.Crypto.MasterKey)
	if err != nil {
		logger.Error("invalid master key", "error", err)
		os.Exit(1)
	}

	// Agent connection manager (shared with gRPC server when co-located)
	connMgr := agent.NewConnManager(logger)

	// Agent gRPC server
	agentSrv := agent.NewServer(connMgr, queries, redisClient, logger)
	grpcServer := grpc.NewServer()
	agentv1.RegisterAgentServiceServer(grpcServer, agentSrv)

	grpcAddr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.GRPCPort)
	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		logger.Error("failed to listen for gRPC", "addr", grpcAddr, "error", err)
		os.Exit(1)
	}

	go func() {
		logger.Info("gRPC server starting", "addr", grpcAddr)
		if err := grpcServer.Serve(lis); err != nil {
			logger.Error("gRPC server error", "error", err)
		}
	}()

	// Onboarding service
	// Build the public gRPC address that remote agents will connect to.
	// Use PublicURL's host (strip scheme) + gRPC port.
	publicGRPCAddr := fmt.Sprintf("%s:%d", stripScheme(cfg.Server.PublicURL), cfg.Server.GRPCPort)
	logger.Info("public URL for agent connections", "url", cfg.Server.PublicURL, "grpc_addr", publicGRPCAddr)
	onboardingSvc := server.NewOnboardingService(queries, logger, masterKey, cfg.Server.PublicURL, publicGRPCAddr)

	// Provisioning service (SSH-based)
	provisionSvc := provisioner.NewService(queries, redisClient, logger, masterKey, cfg.Server.PublicURL, publicGRPCAddr)

	// Status watcher
	statusWatcher := server.NewStatusWatcher(queries, logger)
	go statusWatcher.Run(ctx)

	// Cluster service
	clusterSvc := cluster.NewService(queries, cfg.Cluster.PoolCIDR, logger)

	// Mesh manager
	meshMgr := mesh.NewManager(queries, connMgr, redisClient, logger)

	// Wire mesh regenerator into agent server (for post-keygen mesh rebuild)
	agentSrv.SetMeshRegenerator(meshMgr)

	// Wire deploy triggerer (set after deploySvc is created below)

	// GitHub App service
	githubService := githubsvc.NewService(cfg.GitHub.BaseURL, cfg.GitHub.APIURL, cfg.GitHub.WebhookURL, cfg.GitHub.RedirectURL, logger)

	// Secrets service
	secretSvc := secret.NewService(queries, masterKey, logger)

	// Project & App services
	projectSvc := project.NewService(queries, logger)
	appService := appsvc.NewService(queries, logger)
	buildSvc := build.NewService(queries, redisClient, connMgr, githubService, masterKey, logger)
	deploySvc := deploy.NewService(queries, redisClient, connMgr, secretSvc, logger)
	deploySvc.StartAutoscalerLoop(ctx)
	containerLogSvc := containerlog.NewService(queries, logger)
	containerLogSvc.StartRetentionLoop(ctx, 7)
	observabilitySvc := observability.NewService(
		queries,
		logger,
		cfg.Observability.VictoriaMetricsURL,
		cfg.Observability.VMAgentConfigPath,
		cfg.Observability.VMAgentURL,
	)
	observabilitySvc.StartRetentionLoop(ctx, 30)
	observabilitySvc.StartAlertEvaluator(ctx)

	// Wire deploy triggerer into agent server and build service (for auto-deploy after build)
	agentSrv.SetDeployTriggerer(deploySvc)
	agentSrv.SetObservabilityRecorder(observabilitySvc)
	buildSvc.SetDeployTriggerer(deploySvc)

	// Router & Server
	router := api.NewRouter(queries, sessions, emailSender, auditWriter, cfg, logger, redisClient, masterKey, onboardingSvc, provisionSvc, clusterSvc, connMgr, meshMgr, githubService, secretSvc, projectSvc, appService, buildSvc, deploySvc, containerLogSvc, observabilitySvc)
	srv := api.NewServer(router, cfg.Server.Host, cfg.Server.Port, logger)

	if err := srv.Start(); err != nil {
		grpcServer.GracefulStop()
		logger.Error("server error", "error", err)
		os.Exit(1)
	}

	grpcServer.GracefulStop()
	logger.Info("gRPC server stopped")
}

// stripScheme removes the http:// or https:// prefix from a URL,
// returning just the host (and port if present in the URL).
func stripScheme(rawURL string) string {
	u := rawURL
	for _, prefix := range []string{"https://", "http://"} {
		if len(u) > len(prefix) && u[:len(prefix)] == prefix {
			return u[len(prefix):]
		}
	}
	return u
}
