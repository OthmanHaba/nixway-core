package job

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/metrics"
	"github.com/riverqueue/river"
)

type CleanupExpiredInvitesArgs struct{}

func (CleanupExpiredInvitesArgs) Kind() string { return "cleanup_expired_invites" }

type CleanupExpiredInvitesWorker struct {
	river.WorkerDefaults[CleanupExpiredInvitesArgs]
	queries *db.Queries
	logger  *slog.Logger
}

func (w *CleanupExpiredInvitesWorker) Work(ctx context.Context, job *river.Job[CleanupExpiredInvitesArgs]) (err error) {
	defer func() { metrics.RecordJob(CleanupExpiredInvitesArgs{}.Kind(), err) }()
	count, err := w.queries.DeleteExpiredInvites(ctx)
	if err != nil {
		return fmt.Errorf("cleanup invites: %w", err)
	}
	w.logger.Info("cleaned up expired invites", "count", count)
	return nil
}
