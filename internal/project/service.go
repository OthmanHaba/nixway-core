package project

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type Service struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewService(queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{queries: queries, logger: logger}
}

type CreateParams struct {
	TeamID      uuid.UUID
	ClusterID   uuid.UUID
	Name        string
	Description string
}

func (s *Service) Create(ctx context.Context, p CreateParams) (db.Project, error) {
	slug := generateSlug(p.Name)

	project, err := s.queries.CreateProject(ctx, db.CreateProjectParams{
		TeamID:      p.TeamID,
		ClusterID:   p.ClusterID,
		Name:        p.Name,
		Slug:        slug,
		Description: p.Description,
	})
	if err != nil {
		return db.Project{}, fmt.Errorf("create project: %w", err)
	}

	// Auto-create production environment
	_, err = s.queries.CreateEnvironment(ctx, db.CreateEnvironmentParams{
		ProjectID:    project.ID,
		Name:         "Production",
		Slug:         "production",
		IsProduction: true,
	})
	if err != nil {
		return db.Project{}, fmt.Errorf("create production environment: %w", err)
	}

	s.logger.Info("project created", "id", project.ID, "name", p.Name, "slug", slug)
	return project, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (db.Project, error) {
	return s.queries.GetProject(ctx, id)
}

func (s *Service) List(ctx context.Context, teamID uuid.UUID) ([]db.ListProjectsByTeamRow, error) {
	return s.queries.ListProjectsByTeam(ctx, teamID)
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, name, description, status string) (db.Project, error) {
	return s.queries.UpdateProject(ctx, db.UpdateProjectParams{
		ID:          id,
		Name:        name,
		Description: description,
		Status:      status,
	})
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	return s.queries.DeleteProject(ctx, id)
}

func (s *Service) CreateEnvironment(ctx context.Context, projectID uuid.UUID, name string) (db.Environment, error) {
	slug := generateSlug(name)
	return s.queries.CreateEnvironment(ctx, db.CreateEnvironmentParams{
		ProjectID:    projectID,
		Name:         name,
		Slug:         slug,
		IsProduction: false,
	})
}

func (s *Service) ListEnvironments(ctx context.Context, projectID uuid.UUID) ([]db.Environment, error) {
	return s.queries.ListEnvironmentsByProject(ctx, projectID)
}
