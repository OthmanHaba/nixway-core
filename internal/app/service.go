package app

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/scheduler"
)

type Service struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewService(queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{queries: queries, logger: logger}
}

type CreateParams struct {
	ProjectID            uuid.UUID
	Name                 string
	SourceType           string // "github" or "docker_image"
	GithubInstallationID *uuid.UUID
	RepoFullName         *string
	Branch               *string
	RootPath             string
	AutoDeploy           bool
	DockerImage          *string
	RegistryCredentialID *uuid.UUID
	Builder              string
	DockerfilePath       string
	Port                 int32
	HealthCheckPath      string
	HealthCheckInterval  int32
	HealthCheckTimeout   int32
	Replicas             int32
	Subdomain            *string
	PlacementStrategy    string
	PlacementConstraints scheduler.Constraints
	PinnedServerIDs      []uuid.UUID
}

func (s *Service) Create(ctx context.Context, p CreateParams) (db.App, error) {
	slug := generateSlug(p.Name)

	params := db.CreateAppParams{
		ProjectID:            p.ProjectID,
		Name:                 p.Name,
		Slug:                 slug,
		SourceType:           p.SourceType,
		RepoFullName:         p.RepoFullName,
		Branch:               p.Branch,
		RootPath:             p.RootPath,
		AutoDeploy:           p.AutoDeploy,
		DockerImage:          p.DockerImage,
		Builder:              p.Builder,
		DockerfilePath:       p.DockerfilePath,
		Port:                 p.Port,
		HealthCheckPath:      p.HealthCheckPath,
		HealthCheckInterval:  p.HealthCheckInterval,
		HealthCheckTimeout:   p.HealthCheckTimeout,
		Replicas:             p.Replicas,
		Subdomain:            p.Subdomain,
		PlacementStrategy:    defaultPlacementStrategy(p.PlacementStrategy),
		PlacementConstraints: scheduler.EncodeConstraints(p.PlacementConstraints),
		PinnedServerIds:      nilToEmptyUUIDs(p.PinnedServerIDs),
	}

	if p.GithubInstallationID != nil {
		params.GithubInstallationID = pgtype.UUID{Bytes: *p.GithubInstallationID, Valid: true}
	}
	if p.RegistryCredentialID != nil {
		params.RegistryCredentialID = pgtype.UUID{Bytes: *p.RegistryCredentialID, Valid: true}
	}

	app, err := s.queries.CreateApp(ctx, params)
	if err != nil {
		return db.App{}, fmt.Errorf("create app: %w", err)
	}

	s.logger.Info("app created", "id", app.ID, "name", p.Name, "source", p.SourceType)
	return app, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (db.App, error) {
	return s.queries.GetApp(ctx, id)
}

func (s *Service) List(ctx context.Context, projectID uuid.UUID) ([]db.App, error) {
	return s.queries.ListAppsByProject(ctx, projectID)
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, p UpdateParams) (db.App, error) {
	return s.queries.UpdateApp(ctx, db.UpdateAppParams{
		ID:                   id,
		Name:                 p.Name,
		Branch:               p.Branch,
		RootPath:             p.RootPath,
		AutoDeploy:           p.AutoDeploy,
		Builder:              p.Builder,
		DockerfilePath:       p.DockerfilePath,
		Port:                 p.Port,
		HealthCheckPath:      p.HealthCheckPath,
		HealthCheckInterval:  p.HealthCheckInterval,
		HealthCheckTimeout:   p.HealthCheckTimeout,
		Replicas:             p.Replicas,
		Subdomain:            p.Subdomain,
		CustomDomain:         p.CustomDomain,
		Status:               p.Status,
		PlacementStrategy:    defaultPlacementStrategy(p.PlacementStrategy),
		PlacementConstraints: scheduler.EncodeConstraints(p.PlacementConstraints),
		PinnedServerIds:      nilToEmptyUUIDs(p.PinnedServerIDs),
	})
}

func nilToEmptyUUIDs(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}

type UpdateParams struct {
	Name                 string
	Branch               *string
	RootPath             string
	AutoDeploy           bool
	Builder              string
	DockerfilePath       string
	Port                 int32
	HealthCheckPath      string
	HealthCheckInterval  int32
	HealthCheckTimeout   int32
	Replicas             int32
	Subdomain            *string
	CustomDomain         *string
	Status               string
	PlacementStrategy    string
	PlacementConstraints scheduler.Constraints
	PinnedServerIDs      []uuid.UUID
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	return s.queries.DeleteApp(ctx, id)
}

// GenerateDomain builds the platform domain for an app.
func GenerateDomain(appSlug, projectSlug, teamSlug, baseDomain string) string {
	return fmt.Sprintf("%s-%s-%s.%s", appSlug, projectSlug, teamSlug, baseDomain)
}

var slugNonAlpha = regexp.MustCompile(`[^a-z0-9-]`)
var slugMultiDash = regexp.MustCompile(`-+`)

func generateSlug(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = slugNonAlpha.ReplaceAllString(slug, "-")
	slug = slugMultiDash.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "app"
	}
	if len(slug) > 63 {
		slug = slug[:63]
	}
	return slug
}

func defaultPlacementStrategy(strategy string) string {
	switch strategy {
	case scheduler.StrategyBinpack, scheduler.StrategyPinned:
		return strategy
	default:
		return scheduler.StrategySpread
	}
}
