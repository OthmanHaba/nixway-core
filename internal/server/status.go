package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// StatusWatcher periodically checks server liveness based on last_seen_at
// and updates the status accordingly.
type StatusWatcher struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewStatusWatcher(queries *db.Queries, logger *slog.Logger) *StatusWatcher {
	return &StatusWatcher{queries: queries, logger: logger}
}

// Run blocks and polls every 10 seconds. Call in a goroutine.
func (w *StatusWatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("status watcher stopped")
			return
		case <-ticker.C:
			w.check(ctx)
		}
	}
}

// Check runs a single pass of the status watcher, updating any servers
// whose status has drifted based on last_seen_at. Exported for testing.
func (w *StatusWatcher) Check(ctx context.Context) {
	w.check(ctx)
}

func (w *StatusWatcher) check(ctx context.Context) {
	servers, err := w.queries.ListServersNeedingStatusUpdate(ctx)
	if err != nil {
		w.logger.Error("status watcher: failed to list servers", "error", err)
		return
	}

	now := time.Now()
	for _, s := range servers {
		if !s.LastSeenAt.Valid {
			continue
		}
		elapsed := now.Sub(s.LastSeenAt.Time)

		var newStatus string
		switch {
		case elapsed < 20*time.Second:
			newStatus = "online"
		case elapsed < 50*time.Second:
			newStatus = "degraded"
		default:
			newStatus = "offline"
		}

		if newStatus == s.Status {
			continue
		}

		w.logger.Info("server status transition",
			"server_id", s.ID,
			"old_status", s.Status,
			"new_status", newStatus,
			"elapsed", elapsed,
		)

		err := w.queries.UpdateServerStatus(ctx, db.UpdateServerStatusParams{
			ID:         s.ID,
			Status:     newStatus,
			LastSeenAt: pgtype.Timestamptz{Time: s.LastSeenAt.Time, Valid: true},
		})
		if err != nil {
			w.logger.Error("status watcher: failed to update status",
				"server_id", s.ID,
				"error", err,
			)
		}
	}
}
