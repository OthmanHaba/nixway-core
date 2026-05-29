package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/othmanhaba/nixway-core/internal/job"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.Database.URL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := runMigrations(ctx, pool, logger); err != nil {
		logger.Error("failed to run River migrations", "error", err)
		os.Exit(1)
	}

	queries := db.New(pool)

	var emailSender email.Sender
	switch cfg.Email.Driver {
	case "smtp":
		emailSender = email.NewSMTPSender(cfg.Email.SMTPHost, cfg.Email.SMTPPort, cfg.Email.SMTPUser, cfg.Email.SMTPPass, cfg.Email.From)
	case "resend":
		if cfg.Email.APIKey == "" {
			logger.Error("email driver is resend but NIXWAY_EMAIL_API_KEY is empty")
			os.Exit(1)
		}
		emailSender = email.NewResendSender(cfg.Email.APIKey, cfg.Email.From)
	default:
		emailSender = email.NewConsoleSender(logger)
	}

	client, err := job.NewClient(ctx, pool, queries, emailSender, logger)
	if err != nil {
		logger.Error("failed to create job client", "error", err)
		os.Exit(1)
	}

	logger.Info("worker starting")
	if err := client.Start(ctx); err != nil {
		logger.Error("worker start error", "error", err)
		os.Exit(1)
	}

	<-ctx.Done()
	logger.Info("worker shutting down")
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger) error {
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return err
	}
	res, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	if err != nil {
		return err
	}
	for _, v := range res.Versions {
		logger.Info("applied River migration", "version", v.Version)
	}
	return nil
}
