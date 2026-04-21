package containerlog

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/othmanhaba/nixway-core/internal/db"
)

type Service struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewService(queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{queries: queries, logger: logger}
}

// Ingest persists a single container log line.
func (s *Service) Ingest(ctx context.Context, appID, serverID uuid.UUID, deploymentID *uuid.UUID, containerName string, replicaIndex int, line, stream string, loggedAt time.Time) {
	var depID pgtype.UUID
	if deploymentID != nil {
		depID = pgtype.UUID{Bytes: *deploymentID, Valid: true}
	}

	_ = s.queries.InsertContainerLog(ctx, db.InsertContainerLogParams{
		AppID:         appID,
		DeploymentID:  depID,
		ServerID:      serverID,
		ContainerName: containerName,
		ReplicaIndex:  int32(replicaIndex),
		Line:          line,
		Stream:        stream,
		LoggedAt:      loggedAt,
	})
}

// Search performs full-text search on container logs.
func (s *Service) Search(ctx context.Context, appID uuid.UUID, query string, since, until time.Time, limit int) ([]db.SearchContainerLogsRow, error) {
	return s.queries.SearchContainerLogs(ctx, db.SearchContainerLogsParams{
		AppID:          appID,
		LoggedAt:       since,
		LoggedAt_2:     until,
		PlaintoTsquery: query,
		Limit:          int32(limit),
	})
}

// Tail returns the most recent log lines for an app.
func (s *Service) Tail(ctx context.Context, appID uuid.UUID, lines int) ([]db.TailContainerLogsRow, error) {
	return s.queries.TailContainerLogs(ctx, db.TailContainerLogsParams{
		AppID: appID,
		Limit: int32(lines),
	})
}

// Cleanup deletes logs older than the given retention period.
func (s *Service) Cleanup(ctx context.Context, retentionDays int) (int64, error) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	result, err := s.queries.DeleteOldContainerLogs(ctx, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// StartRetentionLoop runs a daily cleanup goroutine.
func (s *Service) StartRetentionLoop(ctx context.Context, retentionDays int) {
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				deleted, err := s.Cleanup(ctx, retentionDays)
				if err != nil {
					s.logger.Error("log retention cleanup failed", "error", err)
				} else if deleted > 0 {
					s.logger.Info("log retention cleanup", "deleted", deleted)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}
