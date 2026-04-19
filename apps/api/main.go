package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/othmanhaba/nixway-core/internal/api"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	nixredis "github.com/othmanhaba/nixway-core/internal/redis"
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

	// Router & Server
	router := api.NewRouter(queries, sessions, emailSender, auditWriter, cfg, logger)
	server := api.NewServer(router, cfg.Server.Host, cfg.Server.Port, logger)

	if err := server.Start(); err != nil {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}
