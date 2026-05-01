package build

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	githubsvc "github.com/othmanhaba/nixway-core/internal/github"
	"github.com/othmanhaba/nixway-core/internal/registry"
	"github.com/redis/go-redis/v9"
)

// DeployTriggerer triggers a deploy after a successful build.
type DeployTriggerer interface {
	TriggerDeploy(ctx context.Context, appID, envID, buildID uuid.UUID, targetServerID ...*uuid.UUID) (db.Deployment, error)
}

type Service struct {
	queries   *db.Queries
	redis     *redis.Client
	connMgr   *agent.ConnManager
	githubSvc *githubsvc.Service
	resolver  *registry.Resolver
	masterKey [32]byte
	logger    *slog.Logger
	deployer  DeployTriggerer
}

// SetDeployTriggerer sets the deploy triggerer (called after wiring to avoid circular deps).
func (s *Service) SetDeployTriggerer(dt DeployTriggerer) {
	s.deployer = dt
}

func NewService(queries *db.Queries, redisClient *redis.Client, connMgr *agent.ConnManager, githubSvc *githubsvc.Service, masterKey [32]byte, logger *slog.Logger) *Service {
	return &Service{
		queries:   queries,
		redis:     redisClient,
		connMgr:   connMgr,
		githubSvc: githubSvc,
		resolver:  registry.NewResolver(masterKey),
		masterKey: masterKey,
		logger:    logger,
	}
}

// TriggerBuild creates a build record and dispatches the build command to an agent.
func (s *Service) TriggerBuild(ctx context.Context, appID, envID uuid.UUID, triggerType, commitSHA, branch string) (db.Build, error) {
	// Load app to get builder config
	app, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return db.Build{}, fmt.Errorf("get app: %w", err)
	}

	if branch == "" && app.Branch != nil {
		branch = *app.Branch
	}

	b, err := s.queries.CreateBuild(ctx, db.CreateBuildParams{
		AppID:         appID,
		EnvironmentID: envID,
		TriggerType:   triggerType,
		CommitSha:     commitSHA,
		CommitMessage: "",
		Branch:        branch,
		Builder:       app.Builder,
	})
	if err != nil {
		return db.Build{}, fmt.Errorf("create build: %w", err)
	}

	s.logger.Info("build triggered", "build_id", b.ID, "app_id", appID, "trigger", triggerType)

	// Dispatch build to agent asynchronously
	go s.dispatchBuild(context.Background(), b, app)

	return b, nil
}

// dispatchBuild sends the BuildCommand to an available agent in the cluster.
func (s *Service) dispatchBuild(ctx context.Context, b db.Build, app db.App) {
	buildID := b.ID.String()

	// Find a server to build on — get cluster members from the app's project
	project, err := s.queries.GetProject(ctx, app.ProjectID)
	if err != nil {
		s.logger.Error("build dispatch: get project failed", "build_id", buildID, "error", err)
		s.failBuild(ctx, b.ID, "failed to resolve project")
		return
	}

	members, err := s.queries.ListClusterMembers(ctx, project.ClusterID)
	if err != nil || len(members) == 0 {
		s.logger.Error("build dispatch: no cluster members", "build_id", buildID, "error", err)
		s.failBuild(ctx, b.ID, "no servers available in cluster")
		return
	}

	// Find a connected agent from the cluster members
	var targetAgentID string
	for _, m := range members {
		agentID := m.ServerID.String()
		if state := s.connMgr.GetState(agentID); state != nil && state.Status == "online" {
			targetAgentID = agentID
			break
		}
	}

	if targetAgentID == "" {
		s.logger.Error("build dispatch: no online agents", "build_id", buildID)
		s.failBuild(ctx, b.ID, "no online agents in cluster")
		return
	}

	// Resolve registry credentials. Required for any source that produces an
	// image we need to push (i.e. github source). docker_image source skips
	// the build path entirely a few lines below, so this gate only affects
	// real builds.
	var registryAuth *agentv1.RegistryAuth
	var imageTag string
	if app.SourceType == "github" {
		if !app.RegistryCredentialID.Valid {
			s.failBuild(ctx, b.ID, "app has no registry credential — set one in app settings before deploying")
			return
		}
		credID, _ := uuid.FromBytes(app.RegistryCredentialID.Bytes[:])
		cred, err := s.queries.GetRegistryCredentialByID(ctx, db.GetRegistryCredentialByIDParams{
			ID:     credID,
			TeamID: project.TeamID,
		})
		if err != nil {
			s.logger.Error("build dispatch: load registry credential failed", "build_id", buildID, "error", err)
			s.failBuild(ctx, b.ID, "registry credential not found")
			return
		}
		auth, err := s.resolver.Resolve(ctx, cred, project.TeamID)
		if err != nil {
			s.logger.Error("build dispatch: resolve registry credential failed", "build_id", buildID, "error", err)
			s.failBuild(ctx, b.ID, fmt.Sprintf("resolve registry credential: %v", err))
			return
		}
		registryAuth = &agentv1.RegistryAuth{
			Server:   auth.Server,
			Username: auth.Username,
			Password: auth.Password,
		}
		imageTag = fmt.Sprintf("%s%s:%s", auth.TagPrefix, app.Slug, buildID[:8])
	} else {
		// Fallback path; not used by the github builder branch.
		imageTag = fmt.Sprintf("%s:%s", app.Slug, buildID[:8])
	}

	// Build the command
	cmd := &agentv1.BuildCommand{
		BuildId:        buildID,
		Builder:        app.Builder,
		DockerfilePath: app.DockerfilePath,
		ImageTag:       imageTag,
		CommitSha:      b.CommitSha,
		Branch:         b.Branch,
		RootPath:       app.RootPath,
		Registry:       registryAuth,
	}

	// Resolve repo URL and auth token for GitHub source
	if app.SourceType == "github" && app.RepoFullName != nil {
		cmd.RepoUrl = fmt.Sprintf("https://github.com/%s.git", *app.RepoFullName)

		// Get installation token for private repo access
		if app.GithubInstallationID.Valid {
			token, err := s.getInstallationToken(ctx, app.GithubInstallationID.Bytes, project.TeamID)
			if err != nil {
				s.logger.Warn("build dispatch: failed to get GitHub token, will try without auth", "build_id", buildID, "error", err)
			} else {
				cmd.AuthToken = token
			}
		}
	} else if app.SourceType == "docker_image" {
		// For docker image source, skip build — just use the image directly
		s.logger.Info("build dispatch: docker image source, marking as built", "build_id", buildID, "image", *app.DockerImage)
		_ = s.queries.CompleteBuild(ctx, db.CompleteBuildParams{
			ID:       b.ID,
			Status:   "built",
			ImageTag: *app.DockerImage,
			ServerID: pgtype.UUID{},
		})
		channel := fmt.Sprintf("build:%s", buildID)
		s.redis.Publish(ctx, channel, "Using pre-built image: "+*app.DockerImage+"\n")
		s.redis.Publish(ctx, channel, "__done__")

		// Auto-trigger deploy
		if s.deployer != nil {
			_, err := s.deployer.TriggerDeploy(ctx, b.AppID, b.EnvironmentID, b.ID)
			if err != nil {
				s.logger.Error("auto-deploy failed after docker image build", "build_id", buildID, "error", err)
			} else {
				s.logger.Info("auto-deploy triggered after docker image build", "build_id", buildID)
			}
		}
		return
	}

	// Update status to cloning
	_ = s.queries.UpdateBuildStatus(ctx, db.UpdateBuildStatusParams{
		ID:        b.ID,
		Status:    "cloning",
		StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})

	// Send command to agent
	err = s.connMgr.SendToAgent(targetAgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_BuildCommand{
			BuildCommand: cmd,
		},
	})
	if err != nil {
		s.logger.Error("build dispatch: failed to send command", "build_id", buildID, "agent", targetAgentID, "error", err)
		s.failBuild(ctx, b.ID, fmt.Sprintf("failed to send build command to agent: %v", err))
		return
	}

	s.logger.Info("build dispatched to agent", "build_id", buildID, "agent", targetAgentID)
}

func (s *Service) getInstallationToken(ctx context.Context, installationDBID uuid.UUID, teamID uuid.UUID) (string, error) {
	// Look up the installation to get the GitHub installation ID
	inst, err := s.queries.GetGitHubInstallationByID(ctx, installationDBID)
	if err != nil {
		return "", fmt.Errorf("get installation: %w", err)
	}

	// Get the GitHub App for this team
	app, err := s.queries.GetGitHubAppByTeam(ctx, teamID)
	if err != nil {
		return "", fmt.Errorf("get github app: %w", err)
	}

	// Decrypt private key
	privateKey, err := crypto.Decrypt(app.PrivateKey, s.masterKey, "github:"+teamID.String())
	if err != nil {
		return "", fmt.Errorf("decrypt private key: %w", err)
	}

	token, _, err := s.githubSvc.GetInstallationToken(ctx, app.AppID, inst.InstallationID, privateKey)
	if err != nil {
		return "", fmt.Errorf("get installation token: %w", err)
	}

	return token, nil
}

func (s *Service) failBuild(ctx context.Context, buildID uuid.UUID, errMsg string) {
	_ = s.queries.CompleteBuild(ctx, db.CompleteBuildParams{
		ID:     buildID,
		Status: "failed",
		Error:  &errMsg,
	})
	channel := fmt.Sprintf("build:%s", buildID)
	s.redis.Publish(ctx, channel, "ERROR: "+errMsg+"\n")
	s.redis.Publish(ctx, channel, "__done__")
}

// UpdateStatus updates build status and optionally sets started_at.
func (s *Service) UpdateStatus(ctx context.Context, buildID uuid.UUID, status string, setStarted bool, errMsg string) error {
	var startedAt pgtype.Timestamptz
	if setStarted {
		startedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}

	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}

	return s.queries.UpdateBuildStatus(ctx, db.UpdateBuildStatusParams{
		ID:        buildID,
		Status:    status,
		StartedAt: startedAt,
		Error:     errPtr,
	})
}

// Complete marks a build as finished (built or failed).
func (s *Service) Complete(ctx context.Context, buildID uuid.UUID, status, imageTag string, serverID uuid.UUID, errMsg string) error {
	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}

	err := s.queries.CompleteBuild(ctx, db.CompleteBuildParams{
		ID:       buildID,
		Status:   status,
		ImageTag: imageTag,
		ServerID: pgtype.UUID{Bytes: serverID, Valid: serverID != uuid.Nil},
		Error:    errPtr,
	})
	if err != nil {
		return err
	}

	// Signal completion to log subscribers
	channel := fmt.Sprintf("build:%s", buildID)
	s.redis.Publish(ctx, channel, "__done__")

	return nil
}

// AppendLogs appends log output and publishes to Redis for live streaming.
func (s *Service) AppendLogs(ctx context.Context, buildID uuid.UUID, output string) error {
	if err := s.queries.AppendBuildLogs(ctx, db.AppendBuildLogsParams{
		ID:   buildID,
		Logs: output,
	}); err != nil {
		return err
	}

	channel := fmt.Sprintf("build:%s", buildID)
	return s.redis.Publish(ctx, channel, output).Err()
}

// GetLatestSuccessful returns the most recent successful build for an app+environment.
func (s *Service) GetLatestSuccessful(ctx context.Context, appID, envID uuid.UUID) (db.Build, error) {
	return s.queries.GetLatestSuccessfulBuild(ctx, db.GetLatestSuccessfulBuildParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
}
