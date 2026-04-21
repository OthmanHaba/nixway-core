package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"
	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/secret"
)

type Service struct {
	queries   *db.Queries
	redis     *redis.Client
	connMgr   *agent.ConnManager
	secretSvc *secret.Service
	logger    *slog.Logger
}

func NewService(queries *db.Queries, redisClient *redis.Client, connMgr *agent.ConnManager, secretSvc *secret.Service, logger *slog.Logger) *Service {
	return &Service{
		queries:   queries,
		redis:     redisClient,
		connMgr:   connMgr,
		secretSvc: secretSvc,
		logger:    logger,
	}
}

// TriggerDeploy creates a deployment, targets, and dispatches deploy commands to agents.
// If targetServerID is non-nil, deploy to that specific server only.
func (s *Service) TriggerDeploy(ctx context.Context, appID, envID, buildID uuid.UUID, targetServerID ...*uuid.UUID) (db.Deployment, error) {
	app, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return db.Deployment{}, fmt.Errorf("get app: %w", err)
	}

	build, err := s.queries.GetBuild(ctx, buildID)
	if err != nil {
		return db.Deployment{}, fmt.Errorf("get build: %w", err)
	}

	project, err := s.queries.GetProject(ctx, app.ProjectID)
	if err != nil {
		return db.Deployment{}, fmt.Errorf("get project: %w", err)
	}

	members, err := s.queries.ListClusterMembers(ctx, project.ClusterID)
	if err != nil {
		return db.Deployment{}, fmt.Errorf("list cluster members: %w", err)
	}

	if len(members) == 0 {
		return db.Deployment{}, fmt.Errorf("no servers available in cluster")
	}

	// If a specific server is requested, filter to just that one
	var specificServer *uuid.UUID
	if len(targetServerID) > 0 && targetServerID[0] != nil {
		specificServer = targetServerID[0]
		// Verify server is in the cluster
		found := false
		for _, m := range members {
			if m.ServerID == *specificServer {
				found = true
				break
			}
		}
		if !found {
			return db.Deployment{}, fmt.Errorf("server not found in cluster")
		}
	}

	replicas := int(app.Replicas)
	if specificServer != nil {
		replicas = 1
	} else if replicas > len(members) {
		replicas = len(members)
	}

	// Resolve secrets for this environment
	env, err := s.queries.GetEnvironment(ctx, envID)
	if err != nil {
		return db.Deployment{}, fmt.Errorf("get environment: %w", err)
	}

	envVars := map[string]string{}
	if s.secretSvc != nil {
		secrets, err := s.secretSvc.List(ctx, project.TeamID, env.Slug)
		if err == nil && len(secrets) > 0 {
			keys := make([]string, len(secrets))
			for i, sec := range secrets {
				keys[i] = sec.Key
			}
			resolved, err := s.secretSvc.BulkResolve(ctx, project.TeamID, env.Slug, keys, nil, "system")
			if err == nil {
				envVars = resolved
			}
		}
	}

	envSnapshot, _ := json.Marshal(envVars)

	deployment, err := s.queries.CreateDeployment(ctx, db.CreateDeploymentParams{
		AppID:           appID,
		EnvironmentID:   envID,
		BuildID:         buildID,
		Strategy:        "rolling",
		ReplicasDesired: int32(replicas),
		EnvSnapshot:     envSnapshot,
	})
	if err != nil {
		return db.Deployment{}, fmt.Errorf("create deployment: %w", err)
	}

	// Create targets and dispatch
	for i := 0; i < replicas; i++ {
		var member db.ListClusterMembersRow
		if specificServer != nil {
			for _, m := range members {
				if m.ServerID == *specificServer {
					member = m
					break
				}
			}
		} else {
			member = members[i%len(members)]
		}
		target, err := s.queries.CreateDeploymentTarget(ctx, db.CreateDeploymentTargetParams{
			DeploymentID: deployment.ID,
			ServerID:     member.ServerID,
		})
		if err != nil {
			return db.Deployment{}, fmt.Errorf("create target: %w", err)
		}

		// Dispatch deploy command to agent
		go s.dispatchDeploy(context.Background(), deployment, target, build, app, project, member, envVars)
	}

	// Update deployment status to deploying
	_ = s.queries.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{
		ID:        deployment.ID,
		Status:    "deploying",
		StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})

	s.logger.Info("deployment triggered", "deploy_id", deployment.ID, "app_id", appID, "replicas", replicas)
	return deployment, nil
}

func (s *Service) dispatchDeploy(ctx context.Context, deployment db.Deployment, target db.DeploymentTarget, build db.Build, app db.App, project db.Project, member db.ListClusterMembersRow, envVars map[string]string) {
	deployID := deployment.ID.String()
	targetID := target.ID.String()
	agentID := member.ServerID.String()

	// Check agent is online
	if state := s.connMgr.GetState(agentID); state == nil || state.Status != "online" {
		s.logger.Error("deploy: agent not online", "deploy_id", deployID, "agent", agentID)
		s.failTarget(ctx, target.ID, "agent not online")
		return
	}

	// Build domain for Traefik
	team, _ := s.queries.GetTeamByID(ctx, project.TeamID)
	teamSlug := ""
	if team.Slug != "" {
		teamSlug = team.Slug
	}

	// Get server public IP for nip.io domain
	srv, _ := s.queries.GetServerByID(ctx, db.GetServerByIDParams{
		ID:     member.ServerID,
		TeamID: project.TeamID,
	})
	serverIP := srv.PublicIp

	containerName := fmt.Sprintf("nixway-%s-%s", app.Slug, deployID[:8])

	domains := []string{}
	// Auto-generated domain using nip.io (resolves to server IP, no DNS setup needed)
	platformDomain := fmt.Sprintf("%s-%s-%s.%s.nip.io", app.Slug, project.Slug, teamSlug, serverIP)
	domains = append(domains, platformDomain)
	if app.CustomDomain != nil && *app.CustomDomain != "" {
		domains = append(domains, *app.CustomDomain)
	}

	// Store platform domain on deployment
	_ = s.queries.SetDeploymentPlatformDomain(ctx, db.SetDeploymentPlatformDomainParams{
		ID:             deployment.ID,
		PlatformDomain: platformDomain,
	})

	s.PublishLog(ctx, deployment.ID, fmt.Sprintf("Platform domain: http://%s\n", platformDomain))

	// Inject platform env vars
	envVars["PORT"] = fmt.Sprintf("%d", app.Port)
	envVars["PLATFORM_PUBLIC_DOMAIN"] = platformDomain
	envVars["PLATFORM_PRIVATE_IP"] = member.WireguardIp.String()
	envVars["PLATFORM_PRIVATE_DOMAIN"] = fmt.Sprintf("%s.%s.%s.internal", app.Slug, project.Slug, "cluster")
	envVars["CLUSTER_NAME"] = project.ClusterID.String()
	envVars["PROJECT_NAME"] = project.Name
	envVars["APP_NAME"] = app.Name
	envVars["ENVIRONMENT"] = deployment.EnvironmentID.String()
	envVars["DEPLOY_ID"] = deployID
	envVars["GIT_SHA"] = build.CommitSha

	// Stop old containers from previous deployments on this server
	s.stopOldContainers(ctx, deployment, app, member)

	cmd := &agentv1.DeployCommand{
		DeployId:                    deployID,
		TargetId:                    targetID,
		ImageTag:                    build.ImageTag,
		ContainerName:               containerName,
		Port:                        app.Port,
		Env:                         envVars,
		HealthCheckPath:             app.HealthCheckPath,
		HealthCheckIntervalSeconds:  app.HealthCheckInterval,
		HealthCheckTimeoutSeconds:   app.HealthCheckTimeout,
		Traefik: &agentv1.TraefikConfig{
			AppSlug: app.Slug,
			Domains: domains,
			Tls:     false,
			Port:    app.Port,
		},
		MemoryLimitMb:      app.MemoryLimitMb,
		CpuLimitMillicores: app.CpuLimitMillicores,
	}

	// Publish log
	s.PublishLog(ctx, deployment.ID, fmt.Sprintf("Deploying %s to server %s...\n", build.ImageTag, agentID))
	s.PublishLog(ctx, deployment.ID, fmt.Sprintf("Domain: http://%s\n", platformDomain))

	err := s.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_DeployCommand{
			DeployCommand: cmd,
		},
	})
	if err != nil {
		s.logger.Error("deploy: failed to send command", "deploy_id", deployID, "agent", agentID, "error", err)
		s.failTarget(ctx, target.ID, fmt.Sprintf("failed to send deploy command: %v", err))
		return
	}

	s.logger.Info("deploy dispatched", "deploy_id", deployID, "target_id", targetID, "agent", agentID)
}

// stopOldContainers stops containers from previous healthy deployments of this app on this server.
func (s *Service) stopOldContainers(ctx context.Context, currentDeploy db.Deployment, app db.App, member db.ListClusterMembersRow) {
	agentID := member.ServerID.String()

	// Find old healthy containers for this app
	oldContainers, err := s.queries.ListActiveContainersByApp(ctx, app.ID)
	if err != nil {
		s.logger.Warn("failed to list old containers", "app_id", app.ID, "error", err)
		return
	}

	for _, c := range oldContainers {
		// Only stop containers on the same server, skip if no container ID
		if c.ServerID != member.ServerID || c.ContainerID == nil {
			continue
		}

		s.PublishLog(ctx, currentDeploy.ID, fmt.Sprintf("Stopping old container %s on %s...\n", *c.ContainerID, c.ServerName))

		_ = s.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
			Payload: &agentv1.ControlMessage_StopContainer{
				StopContainer: &agentv1.StopContainerCommand{
					ContainerName: *c.ContainerID,
					TimeoutSeconds: 10,
				},
			},
		})
	}
}

func (s *Service) failTarget(ctx context.Context, targetID uuid.UUID, errMsg string) {
	_ = s.queries.UpdateDeploymentTargetStatus(ctx, db.UpdateDeploymentTargetStatusParams{
		ID:     targetID,
		Status: "failed",
		Error:  &errMsg,
	})
}

// Rollback finds the last healthy deployment's build and creates a new deployment with it.
func (s *Service) Rollback(ctx context.Context, appID, envID uuid.UUID) (db.Deployment, error) {
	lastHealthy, err := s.queries.GetLastHealthyDeployment(ctx, db.GetLastHealthyDeploymentParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
	if err != nil {
		return db.Deployment{}, fmt.Errorf("no healthy deployment to rollback to: %w", err)
	}

	return s.TriggerDeploy(ctx, appID, envID, lastHealthy.BuildID, nil)
}

// UpdateStatus updates deployment status.
func (s *Service) UpdateStatus(ctx context.Context, deployID uuid.UUID, status string, setStarted bool, errMsg string) error {
	var startedAt pgtype.Timestamptz
	if setStarted {
		startedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}

	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}

	return s.queries.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{
		ID:        deployID,
		Status:    status,
		StartedAt: startedAt,
		Error:     errPtr,
	})
}

// Complete marks a deployment as finished.
func (s *Service) Complete(ctx context.Context, deployID uuid.UUID, status, errMsg string) error {
	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}

	err := s.queries.CompleteDeployment(ctx, db.CompleteDeploymentParams{
		ID:     deployID,
		Status: status,
		Error:  errPtr,
	})
	if err != nil {
		return err
	}

	channel := fmt.Sprintf("deploy:%s", deployID)
	s.redis.Publish(ctx, channel, "__done__")

	return nil
}

// UpdateTargetStatus updates the status of a deployment target.
func (s *Service) UpdateTargetStatus(ctx context.Context, targetID uuid.UUID, status, containerID string, healthy bool, attempts int32, errMsg string) error {
	var healthyAt, stoppedAt pgtype.Timestamptz
	if healthy {
		healthyAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}
	if status == "stopped" {
		stoppedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}

	var startedAt pgtype.Timestamptz
	if status != "pending" {
		startedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}

	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}

	var containerPtr *string
	if containerID != "" {
		containerPtr = &containerID
	}

	return s.queries.UpdateDeploymentTargetStatus(ctx, db.UpdateDeploymentTargetStatusParams{
		ID:                  targetID,
		Status:              status,
		ContainerID:         containerPtr,
		StartedAt:           startedAt,
		HealthyAt:           healthyAt,
		StoppedAt:           stoppedAt,
		HealthCheckAttempts: attempts,
		Error:               errPtr,
	})
}

// PublishLog publishes a deploy log line to Redis for SSE streaming and persists to DB.
func (s *Service) PublishLog(ctx context.Context, deployID uuid.UUID, msg string) {
	// Persist to DB
	_ = s.queries.AppendDeploymentLogs(ctx, db.AppendDeploymentLogsParams{
		ID:   deployID,
		Logs: msg,
	})
	// Stream to SSE subscribers
	channel := fmt.Sprintf("deploy:%s", deployID)
	s.redis.Publish(ctx, channel, msg)
}
