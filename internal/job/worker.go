package job

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

func NewClient(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, emailSender email.Sender, logger *slog.Logger) (*river.Client[pgx.Tx], error) {
	workers := river.NewWorkers()
	river.AddWorker(workers, &SendEmailWorker{sender: emailSender})
	river.AddWorker(workers, &CleanupExpiredInvitesWorker{queries: queries, logger: logger})

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 10},
		},
		Workers: workers,
	})
	if err != nil {
		return nil, err
	}
	return client, nil
}
