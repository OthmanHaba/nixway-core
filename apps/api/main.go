package main

import (
	"context"
	"encoding/hex"
	"log/slog"
	"os"

	"github.com/othmanhaba/nixway-core/internal/agent"
	"github.com/othmanhaba/nixway-core/internal/api"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	nixredis "github.com/othmanhaba/nixway-core/internal/redis"
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

	// Master key
	var masterKey [32]byte
	if cfg.Crypto.MasterKey != "" {
		masterKey, err = crypto.MasterKeyFromHex(cfg.Crypto.MasterKey)
		if err != nil {
			logger.Error("invalid master key", "error", err)
			os.Exit(1)
		}
	} else {
		masterKey = crypto.GenerateMasterKey()
		logger.Warn("no master key configured, generated a random one for dev",
			"master_key_hex", hex.EncodeToString(masterKey[:]),
		)
	}

	// Onboarding service
	logger.Info("public URL for agent connections", "url", cfg.Server.PublicURL)
	onboardingSvc := server.NewOnboardingService(queries, logger, masterKey, cfg.Server.PublicURL)

	// Agent connection manager (shared with gRPC server when co-located)
	connMgr := agent.NewConnManager(logger)

	// Status watcher
	statusWatcher := server.NewStatusWatcher(queries, logger)
	go statusWatcher.Run(ctx)

	// Router & Server
	router := api.NewRouter(queries, sessions, emailSender, auditWriter, cfg, logger, redisClient, masterKey, onboardingSvc, connMgr)
	srv := api.NewServer(router, cfg.Server.Host, cfg.Server.Port, logger)

	if err := srv.Start(); err != nil {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}
