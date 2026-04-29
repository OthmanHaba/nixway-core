package database

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/othmanhaba/nixway-core/internal/db"
)

// CreateSavedQuery persists a named query under a project. databaseID may be
// uuid.Nil to make the query database-agnostic.
func (s *Service) CreateSavedQuery(ctx context.Context, projectID, userID, databaseID uuid.UUID, name, queryText string) (db.DatabaseSavedQuery, error) {
	row, err := s.queries.CreateDatabaseSavedQuery(ctx, db.CreateDatabaseSavedQueryParams{
		ProjectID:  projectID,
		UserID:     userID,
		DatabaseID: pgUUIDOrNull(databaseID),
		Name:       name,
		QueryText:  queryText,
	})
	if err != nil {
		return db.DatabaseSavedQuery{}, fmt.Errorf("create saved query: %w", err)
	}
	return row, nil
}

// ListSavedQueriesByProject returns all saved queries scoped to the project.
func (s *Service) ListSavedQueriesByProject(ctx context.Context, projectID uuid.UUID) ([]db.DatabaseSavedQuery, error) {
	rows, err := s.queries.ListDatabaseSavedQueriesByProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("list saved queries: %w", err)
	}
	return rows, nil
}

// GetSavedQuery returns a single saved query by ID.
func (s *Service) GetSavedQuery(ctx context.Context, id uuid.UUID) (db.DatabaseSavedQuery, error) {
	return s.queries.GetDatabaseSavedQuery(ctx, id)
}

// UpdateSavedQuery edits an existing saved query.
func (s *Service) UpdateSavedQuery(ctx context.Context, id uuid.UUID, name, queryText string) (db.DatabaseSavedQuery, error) {
	row, err := s.queries.UpdateDatabaseSavedQuery(ctx, db.UpdateDatabaseSavedQueryParams{
		ID:        id,
		Name:      name,
		QueryText: queryText,
	})
	if err != nil {
		return db.DatabaseSavedQuery{}, fmt.Errorf("update saved query: %w", err)
	}
	return row, nil
}

// DeleteSavedQuery removes a saved query.
func (s *Service) DeleteSavedQuery(ctx context.Context, id uuid.UUID) error {
	if err := s.queries.DeleteDatabaseSavedQuery(ctx, id); err != nil {
		return fmt.Errorf("delete saved query: %w", err)
	}
	return nil
}

// ensureSavedQueryParam keeps the unused-import compiler happy when this
// file is built before saved-queries are actually used; pgtype is used
// implicitly through pgUUIDOrNull but kept here as a tripwire.
var _ = pgtype.UUID{}
