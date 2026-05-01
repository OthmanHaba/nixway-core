package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"

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
	"github.com/othmanhaba/nixway-core/internal/database"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/deploy"
	"github.com/othmanhaba/nixway-core/internal/email"
	githubsvc "github.com/othmanhaba/nixway-core/internal/github"
	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/othmanhaba/nixway-core/internal/observability"
	"github.com/othmanhaba/nixway-core/internal/platform"
	"github.com/othmanhaba/nixway-core/internal/project"
	"github.com/othmanhaba/nixway-core/internal/provisioner"
	nixredis "github.com/othmanhaba/nixway-core/internal/redis"
	"github.com/othmanhaba/nixway-core/internal/secret"
	"github.com/othmanhaba/nixway-core/internal/server"
	"github.com/othmanhaba/nixway-core/internal/template"
	"github.com/othmanhaba/nixway-core/internal/volume"
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
	grpcHost := cfg.Server.AgentGRPCHost
	if grpcHost == "" {
		grpcHost = grpcHostFromPublicURL(cfg.Server.PublicURL)
	}
	publicGRPCAddr := fmt.Sprintf("%s:%d", grpcHost, cfg.Server.GRPCPort)
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

	// Service template registry (static catalog of databases, caches, etc.)
	templateRegistry := template.NewRegistry()

	// Volume service (bind-mount based, soft quota)
	volumeSvc := volume.NewService(queries, connMgr, logger)
	agentSrv.SetVolumeResultHandler(volumeSvc.HandleResult)

	// Platform storage (MinIO by default; backs Phase 8.7 backups). Optional —
	// the platform must still boot when credentials are not configured. We
	// initialise this BEFORE the database service so we can inject it into the
	// constructor.
	minioClient, err := platform.NewMinIOClient(cfg.PlatformStorage, logger)
	if err != nil {
		logger.Warn("platform storage not initialised; backups will be unavailable until configured",
			"error", err,
			"endpoint", cfg.PlatformStorage.Endpoint,
			"bucket", cfg.PlatformStorage.Bucket,
		)
		minioClient = nil
	} else {
		if err := minioClient.EnsureBucket(ctx); err != nil {
			logger.Warn("could not ensure platform storage bucket; continuing",
				"error", err,
				"bucket", minioClient.Bucket(),
			)
		} else {
			logger.Info("platform storage ready", "endpoint", minioClient.Endpoint(), "bucket", minioClient.Bucket())
		}
	}

	// Database service (managed databases via templates + volumes + secrets)
	databaseSvc := database.NewService(queries, volumeSvc, templateRegistry, secretSvc, connMgr, meshMgr, minioClient, logger)
	// Cross-wire deploy <-> database to break the import cycle:
	//  - deploy.BuildEnv uses database.BuildEnvForApp to inject linked DB env
	//  - database.RotateAppUserCredential uses deploy.RedeployAppLatest to roll
	deploySvc.SetDatabaseLinkResolver(databaseSvc)
	databaseSvc.SetRedeployTrigger(deploySvc)
	// Register the agent callback for credential-rotation ALTER USER results.
	agentSrv.SetDatabaseAlterUserResultHandler(databaseSvc.HandleAlterUserResult)
	// Register the agent callback for database query results (tooling UI relay).
	agentSrv.SetDatabaseQueryResultHandler(databaseSvc.HandleQueryResult)
	// Register the agent callbacks for backup + restore results (Phase 8.7).
	agentSrv.SetBackupResultHandler(databaseSvc.HandleBackupResult)
	agentSrv.SetRestoreResultHandler(databaseSvc.HandleRestoreResult)
	// Route DeployOutput for in-flight database provisions to the database
	// service so the row only flips to 'running' after the agent reports
	// healthy. App-deployment outputs flow through the standard path.
	agentSrv.SetDatabaseDeployResultHandler(databaseSvc.HandleDeployResult)
	// Wire Redis into the database service for query rate-limiting.
	databaseSvc.SetRedis(redisClient)
	// Launch the cron-eval goroutine that triggers scheduled backups.
	databaseSvc.StartBackupScheduler(ctx)

	// Router & Server
	router := api.NewRouter(queries, sessions, emailSender, auditWriter, cfg, logger, redisClient, masterKey, onboardingSvc, provisionSvc, clusterSvc, connMgr, meshMgr, githubService, secretSvc, projectSvc, appService, buildSvc, deploySvc, containerLogSvc, observabilitySvc, templateRegistry, volumeSvc, minioClient, databaseSvc)
	srv := api.NewServer(router, cfg.Server.Host, cfg.Server.Port, logger)

	if err := srv.Start(); err != nil {
		grpcServer.GracefulStop()
		logger.Error("server error", "error", err)
		os.Exit(1)
	}

	grpcServer.GracefulStop()
	logger.Info("gRPC server stopped")
}

// grpcHostFromPublicURL extracts only the hostname from the HTTP public URL so
// the agent gRPC address can use its own port.
func grpcHostFromPublicURL(rawURL string) string {
	host := rawURL
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Host != "" {
		host = parsed.Host
	}

	if slash := strings.Index(host, "/"); slash >= 0 {
		host = host[:slash]
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
}
