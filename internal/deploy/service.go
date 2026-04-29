package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/scheduler"
	"github.com/othmanhaba/nixway-core/internal/secret"
	"github.com/redis/go-redis/v9"
)

// DatabaseLinkResolver resolves the env-var map injected at deploy time from
// the databases linked to an app. Implemented by database.Service. Kept as an
// interface to avoid an import cycle (database depends on deploy for the
// rotation -> redeploy hook).
type DatabaseLinkResolver interface {
	BuildEnvForApp(ctx context.Context, appID uuid.UUID) (map[string]string, error)
}

type Service struct {
	queries   *db.Queries
	redis     *redis.Client
	connMgr   *agent.ConnManager
	secretSvc *secret.Service
	dbLinks   DatabaseLinkResolver
	logger    *slog.Logger
}

type scheduledTarget struct {
	member db.ListClusterMembersRow
	reason string
}

type ScaleRequest struct {
	Replicas             int32
	PlacementStrategy    string
	PlacementConstraints scheduler.Constraints
	PinnedServerIDs      []uuid.UUID
	ActorID              *uuid.UUID
	ActorType            string
	EventType            string
	MetricName           *string
	MetricValue          *float64
	RuleName             *string
}

type ScaleResult struct {
	App        db.App          `json:"app"`
	Event      db.ScalingEvent `json:"event"`
	Deployment *db.Deployment  `json:"deployment,omitempty"`
}

type AutoscaleEvaluation struct {
	RuleID      uuid.UUID        `json:"rule_id"`
	RuleName    string           `json:"rule_name"`
	MetricName  string           `json:"metric_name"`
	MetricValue float64          `json:"metric_value"`
	Triggered   bool             `json:"triggered"`
	Event       *db.ScalingEvent `json:"event,omitempty"`
	Message     string           `json:"message"`
}

type TrafficView struct {
	Route    *db.TrafficRoute                   `json:"route,omitempty"`
	Backends []db.ListTrafficBackendsByRouteRow `json:"backends"`
	Events   []db.TrafficEvent                  `json:"events"`
}

type TrafficWeight struct {
	BackendID uuid.UUID `json:"backend_id"`
	Weight    int32     `json:"weight"`
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

// SetDatabaseLinkResolver wires the DB-link env injector. Called after both
// services are constructed to break the import cycle. Safe to leave nil; if
// nil, deploys do not get DB env injected (legacy behaviour).
func (s *Service) SetDatabaseLinkResolver(r DatabaseLinkResolver) {
	s.dbLinks = r
}

// RedeployAppLatest triggers a fresh deploy of an app using its last-healthy
// build into its production environment. Used by database.Service after a
// link/unlink/rotation so apps pick up the new env. Returns a permission-style
// error when there is no healthy deployment to re-roll (the app needs an
// initial deploy first).
func (s *Service) RedeployAppLatest(ctx context.Context, appID uuid.UUID) (db.Deployment, error) {
	app, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return db.Deployment{}, fmt.Errorf("get app: %w", err)
	}
	envID, err := s.productionEnvironment(ctx, app.ProjectID)
	if err != nil {
		return db.Deployment{}, err
	}
	lastHealthy, err := s.queries.GetLastHealthyDeployment(ctx, db.GetLastHealthyDeploymentParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
	if err != nil {
		return db.Deployment{}, fmt.Errorf("no healthy deployment to redeploy: %w", err)
	}
	return s.TriggerDeploy(ctx, appID, envID, lastHealthy.BuildID, nil)
}

func (s *Service) StartAutoscalerLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				appIDs, err := s.queries.ListAppsWithEnabledAutoscaling(ctx)
				if err != nil {
					s.logger.Warn("autoscaler: list apps failed", "error", err)
					continue
				}
				for _, appID := range appIDs {
					if _, err := s.EvaluateAutoscaling(ctx, appID); err != nil {
						s.logger.Debug("autoscaler: evaluation skipped", "app_id", appID, "error", err)
					}
				}
			}
		}
	}()
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

	var targets []scheduledTarget
	if specificServer != nil {
		target, err := targetForSpecificServer(*specificServer, members)
		if err != nil {
			return db.Deployment{}, err
		}
		targets = []scheduledTarget{target}
	} else {
		targets, err = s.scheduleTargets(ctx, app, project, members)
		if err != nil {
			return db.Deployment{}, err
		}
	}
	replicas := len(targets)

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
	// Merge env vars derived from database links. Linked-DB vars OVERRIDE any
	// matching user secret so a freshly-rotated password always takes effect
	// even if the operator left a stale DATABASE_URL secret behind.
	if s.dbLinks != nil {
		dbEnv, err := s.dbLinks.BuildEnvForApp(ctx, appID)
		if err != nil {
			s.logger.Warn("build database link env failed; deploying without DB env", "app_id", appID, "error", err)
		} else {
			for k, v := range dbEnv {
				envVars[k] = v
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
	for _, scheduled := range targets {
		member := scheduled.member
		target, err := s.queries.CreateDeploymentTarget(ctx, db.CreateDeploymentTargetParams{
			DeploymentID: deployment.ID,
			ServerID:     member.ServerID,
		})
		if err != nil {
			return db.Deployment{}, fmt.Errorf("create target: %w", err)
		}

		// Dispatch deploy command to agent
		s.PublishLog(ctx, deployment.ID, fmt.Sprintf("Scheduler: %s\n", scheduled.reason))
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

func targetForSpecificServer(serverID uuid.UUID, members []db.ListClusterMembersRow) (scheduledTarget, error) {
	for _, member := range members {
		if member.ServerID == serverID {
			return scheduledTarget{
				member: member,
				reason: fmt.Sprintf("manual server target selected %s", member.ServerName),
			}, nil
		}
	}
	return scheduledTarget{}, fmt.Errorf("server not found in cluster")
}

func (s *Service) scheduleTargets(ctx context.Context, app db.App, project db.Project, members []db.ListClusterMembersRow) ([]scheduledTarget, error) {
	memberByServer := make(map[uuid.UUID]db.ListClusterMembersRow, len(members))
	for _, member := range members {
		memberByServer[member.ServerID] = member
	}

	rows, err := s.queries.ListClusterMembersForScheduling(ctx, project.ClusterID)
	if err != nil {
		return nil, fmt.Errorf("load scheduler candidates: %w", err)
	}

	candidates := make([]scheduler.Candidate, 0, len(rows))
	for _, row := range rows {
		tags := map[string]string{}
		serverTags, err := s.queries.ListServerTags(ctx, row.ServerID)
		if err == nil {
			for _, tag := range serverTags {
				tags[tag.Key] = tag.Value
			}
		}

		candidate := scheduler.Candidate{
			ServerID:        row.ServerID,
			ServerName:      row.ServerName,
			Status:          row.ServerStatus,
			Tags:            tags,
			RunningReplicas: row.RunningReplicas,
		}
		if row.CpuCores != nil {
			candidate.CPUCapacity = *row.CpuCores * 1000
			candidate.HasCPUData = true
		}
		if row.MemoryAvailable != nil {
			candidate.MemoryAvailable = *row.MemoryAvailable
			candidate.HasMemoryData = true
		}
		candidates = append(candidates, candidate)
	}

	assignments, err := scheduler.Schedule(scheduler.Requirements{
		Replicas:           app.Replicas,
		Strategy:           app.PlacementStrategy,
		PinnedServerIDs:    app.PinnedServerIds,
		Constraints:        scheduler.ParseConstraints(app.PlacementConstraints),
		MemoryLimitMB:      app.MemoryLimitMb,
		CPULimitMillicores: app.CpuLimitMillicores,
	}, candidates)
	if err != nil {
		return nil, err
	}

	targets := make([]scheduledTarget, 0, len(assignments))
	for _, assignment := range assignments {
		member, ok := memberByServer[assignment.ServerID]
		if !ok {
			return nil, fmt.Errorf("scheduled server %s is not a cluster member", assignment.ServerID)
		}
		targets = append(targets, scheduledTarget{
			member: member,
			reason: assignment.Reason,
		})
	}
	return targets, nil
}

func (s *Service) ScaleApp(ctx context.Context, appID uuid.UUID, req ScaleRequest) (ScaleResult, error) {
	current, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return ScaleResult{}, fmt.Errorf("get app: %w", err)
	}
	if req.Replicas <= 0 {
		return ScaleResult{}, fmt.Errorf("replicas must be greater than zero")
	}
	if req.PlacementStrategy == "" {
		req.PlacementStrategy = current.PlacementStrategy
	}
	switch req.PlacementStrategy {
	case scheduler.StrategySpread, scheduler.StrategyBinpack, scheduler.StrategyPinned:
	default:
		return ScaleResult{}, fmt.Errorf("unknown placement strategy %q", req.PlacementStrategy)
	}
	if req.ActorType == "" {
		req.ActorType = "user"
	}
	if req.EventType == "" {
		req.EventType = "manual_scale"
	}

	updated, err := s.queries.UpdateAppScaling(ctx, db.UpdateAppScalingParams{
		ID:                   appID,
		Replicas:             req.Replicas,
		PlacementStrategy:    req.PlacementStrategy,
		PlacementConstraints: scheduler.EncodeConstraints(req.PlacementConstraints),
		PinnedServerIds:      req.PinnedServerIDs,
	})
	if err != nil {
		return ScaleResult{}, fmt.Errorf("update app scaling: %w", err)
	}

	envID, err := s.productionEnvironment(ctx, updated.ProjectID)
	if err != nil {
		return ScaleResult{}, err
	}

	var deployment *db.Deployment
	message := "Scaling settings saved"
	lastHealthy, err := s.queries.GetLastHealthyDeployment(ctx, db.GetLastHealthyDeploymentParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
	if err == nil {
		next, err := s.TriggerDeploy(ctx, appID, envID, lastHealthy.BuildID, nil)
		if err != nil {
			return ScaleResult{}, err
		}
		deployment = &next
		message = fmt.Sprintf("Scaling from %d to %d replicas", current.Replicas, req.Replicas)
	} else {
		message = "Scaling settings saved; deploy a build to apply them"
	}

	event, err := s.createScalingEvent(ctx, db.CreateScalingEventParams{
		AppID:             appID,
		EnvironmentID:     pgtype.UUID{Bytes: envID, Valid: true},
		DeploymentID:      deploymentUUID(deployment),
		ActorID:           actorUUID(req.ActorID),
		ActorType:         req.ActorType,
		EventType:         req.EventType,
		FromReplicas:      current.Replicas,
		ToReplicas:        req.Replicas,
		PlacementStrategy: req.PlacementStrategy,
		MetricName:        req.MetricName,
		MetricValue:       req.MetricValue,
		RuleName:          req.RuleName,
		Message:           message,
		Metadata:          []byte(`{}`),
	})
	if err != nil {
		return ScaleResult{}, err
	}

	return ScaleResult{App: updated, Event: event, Deployment: deployment}, nil
}

func (s *Service) productionEnvironment(ctx context.Context, projectID uuid.UUID) (uuid.UUID, error) {
	envs, err := s.queries.ListEnvironmentsByProject(ctx, projectID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("list environments: %w", err)
	}
	if len(envs) == 0 {
		return uuid.Nil, fmt.Errorf("no environments found")
	}
	for _, env := range envs {
		if env.IsProduction {
			return env.ID, nil
		}
	}
	return envs[0].ID, nil
}

func (s *Service) createScalingEvent(ctx context.Context, params db.CreateScalingEventParams) (db.ScalingEvent, error) {
	event, err := s.queries.CreateScalingEvent(ctx, params)
	if err != nil {
		return db.ScalingEvent{}, fmt.Errorf("create scaling event: %w", err)
	}
	return event, nil
}

func deploymentUUID(deployment *db.Deployment) pgtype.UUID {
	if deployment == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: deployment.ID, Valid: true}
}

func actorUUID(actorID *uuid.UUID) pgtype.UUID {
	if actorID == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *actorID, Valid: true}
}

func trafficDomain(app db.App, deployment db.Deployment) string {
	if app.CustomDomain != nil && *app.CustomDomain != "" && app.DomainVerified {
		return *app.CustomDomain
	}
	if deployment.PlatformDomain != "" {
		return deployment.PlatformDomain
	}
	if len(app.Domains) > 0 && app.Domains[0] != "" {
		return app.Domains[0]
	}
	return ""
}

func trafficDomains(app db.App, route db.TrafficRoute) []string {
	seen := map[string]bool{}
	var domains []string
	add := func(domain string) {
		if domain == "" || seen[domain] {
			return
		}
		seen[domain] = true
		domains = append(domains, domain)
	}
	add(route.Domain)
	if app.CustomDomain != nil && app.DomainVerified {
		add(*app.CustomDomain)
	}
	for _, domain := range app.Domains {
		add(domain)
	}
	return domains
}

func shortSHA(sha string) string {
	if len(sha) <= 7 {
		return sha
	}
	return sha[:7]
}

func trafficServiceName(appSlug, label string, deploymentID uuid.UUID) string {
	name := fmt.Sprintf("%s-%s-%s", appSlug, label, deploymentID.String()[:8])
	return name
}

func (s *Service) StopSupersededContainers(ctx context.Context, deploymentID uuid.UUID) error {
	current, err := s.queries.GetDeployment(ctx, deploymentID)
	if err != nil {
		return fmt.Errorf("get deployment: %w", err)
	}
	app, err := s.queries.GetApp(ctx, current.AppID)
	if err != nil {
		return fmt.Errorf("get app: %w", err)
	}
	currentTargets, err := s.queries.ListDeploymentTargets(ctx, deploymentID)
	if err != nil {
		return fmt.Errorf("list current targets: %w", err)
	}
	currentServers := make(map[uuid.UUID]bool, len(currentTargets))
	for _, target := range currentTargets {
		currentServers[target.ServerID] = true
	}

	containers, err := s.queries.ListHealthyContainersByApp(ctx, current.AppID)
	if err != nil {
		return fmt.Errorf("list healthy containers: %w", err)
	}
	for _, container := range containers {
		if container.DeploymentID == deploymentID || container.ContainerID == nil || container.AgentID == nil {
			continue
		}
		removeTraefik := !currentServers[container.ServerID]
		if err := s.connMgr.SendToAgent(*container.AgentID, &agentv1.ControlMessage{
			Payload: &agentv1.ControlMessage_StopContainer{
				StopContainer: &agentv1.StopContainerCommand{
					ContainerName:  *container.ContainerID,
					TimeoutSeconds: 30,
					RemoveTraefik:  removeTraefik,
					AppSlug:        app.Slug,
				},
			},
		}); err != nil {
			s.logger.Warn("failed to stop superseded container", "container", *container.ContainerID, "server", container.ServerID, "error", err)
			continue
		}
		_ = s.queries.UpdateDeploymentTargetStatus(ctx, db.UpdateDeploymentTargetStatusParams{
			ID:        container.TargetID,
			Status:    "stopped",
			StoppedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
	}
	return nil
}

func (s *Service) EnsureTrafficForDeployment(ctx context.Context, deploymentID uuid.UUID) error {
	deployment, err := s.queries.GetDeployment(ctx, deploymentID)
	if err != nil {
		return fmt.Errorf("get deployment: %w", err)
	}
	app, err := s.queries.GetApp(ctx, deployment.AppID)
	if err != nil {
		return fmt.Errorf("get app: %w", err)
	}
	domain := trafficDomain(app, deployment)
	if domain == "" {
		return fmt.Errorf("no domain available for traffic route")
	}
	route, err := s.queries.EnsureTrafficRoute(ctx, db.EnsureTrafficRouteParams{
		AppID:         app.ID,
		EnvironmentID: deployment.EnvironmentID,
		Domain:        domain,
	})
	if err != nil {
		return fmt.Errorf("ensure route: %w", err)
	}
	count, _ := s.queries.CountTrafficBackendsByRoute(ctx, route.ID)
	weight := int32(0)
	label := "candidate"
	if count == 0 {
		weight = 100
		label = "stable"
	}
	if deployment.BuildID != uuid.Nil {
		if build, err := s.queries.GetBuild(ctx, deployment.BuildID); err == nil && build.CommitSha != "" {
			label = fmt.Sprintf("%s-%s", label, shortSHA(build.CommitSha))
		}
	}
	_, err = s.queries.UpsertTrafficBackend(ctx, db.UpsertTrafficBackendParams{
		RouteID:      route.ID,
		DeploymentID: deployment.ID,
		Label:        label,
		Weight:       weight,
		Status:       "active",
	})
	if err != nil {
		return fmt.Errorf("upsert backend: %w", err)
	}
	_, _ = s.queries.CreateTrafficEvent(ctx, db.CreateTrafficEventParams{
		RouteID:   route.ID,
		ActorType: "system",
		EventType: "backend_added",
		Message:   fmt.Sprintf("Added deployment %s as %s with weight %d", deployment.ID.String()[:8], label, weight),
		Metadata:  []byte(`{}`),
	})
	return s.SyncTrafficRoute(ctx, route.ID)
}

func (s *Service) GetTraffic(ctx context.Context, appID uuid.UUID) (TrafficView, error) {
	app, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return TrafficView{}, fmt.Errorf("get app: %w", err)
	}
	envID, err := s.productionEnvironment(ctx, app.ProjectID)
	if err != nil {
		return TrafficView{}, err
	}
	route, err := s.queries.GetTrafficRouteByAppEnvironment(ctx, db.GetTrafficRouteByAppEnvironmentParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
	if err != nil {
		return TrafficView{Backends: []db.ListTrafficBackendsByRouteRow{}, Events: []db.TrafficEvent{}}, nil
	}
	backends, err := s.queries.ListTrafficBackendsByRoute(ctx, route.ID)
	if err != nil {
		return TrafficView{}, fmt.Errorf("list backends: %w", err)
	}
	events, _ := s.queries.ListTrafficEventsByRoute(ctx, db.ListTrafficEventsByRouteParams{
		RouteID: route.ID,
		Limit:   20,
		Offset:  0,
	})
	return TrafficView{Route: &route, Backends: backends, Events: events}, nil
}

func (s *Service) UpdateTrafficWeights(ctx context.Context, appID uuid.UUID, weights []TrafficWeight, actorID *uuid.UUID, actorType string) (TrafficView, error) {
	view, err := s.GetTraffic(ctx, appID)
	if err != nil {
		return TrafficView{}, err
	}
	if view.Route == nil {
		return TrafficView{}, fmt.Errorf("no traffic route exists yet")
	}
	total := int32(0)
	for _, weight := range weights {
		if weight.Weight < 0 || weight.Weight > 100 {
			return TrafficView{}, fmt.Errorf("traffic weights must be between 0 and 100")
		}
		total += weight.Weight
	}
	if total != 100 {
		return TrafficView{}, fmt.Errorf("traffic weights must total 100")
	}
	for _, weight := range weights {
		if _, err := s.queries.UpdateTrafficBackendWeight(ctx, db.UpdateTrafficBackendWeightParams{
			ID:      weight.BackendID,
			RouteID: view.Route.ID,
			Weight:  weight.Weight,
		}); err != nil {
			return TrafficView{}, fmt.Errorf("update backend weight: %w", err)
		}
	}
	if actorType == "" {
		actorType = "user"
	}
	_, _ = s.queries.CreateTrafficEvent(ctx, db.CreateTrafficEventParams{
		RouteID:   view.Route.ID,
		ActorID:   actorUUID(actorID),
		ActorType: actorType,
		EventType: "weights_updated",
		Message:   "Updated traffic weights",
		Metadata:  []byte(`{}`),
	})
	if err := s.SyncTrafficRoute(ctx, view.Route.ID); err != nil {
		return TrafficView{}, err
	}
	return s.GetTraffic(ctx, appID)
}

func (s *Service) PromoteTrafficBackend(ctx context.Context, appID, backendID uuid.UUID, actorID *uuid.UUID) (TrafficView, error) {
	view, err := s.GetTraffic(ctx, appID)
	if err != nil {
		return TrafficView{}, err
	}
	if view.Route == nil {
		return TrafficView{}, fmt.Errorf("no traffic route exists yet")
	}
	weights := make([]TrafficWeight, 0, len(view.Backends))
	for _, backend := range view.Backends {
		weight := int32(0)
		if backend.ID == backendID {
			weight = 100
		}
		weights = append(weights, TrafficWeight{BackendID: backend.ID, Weight: weight})
	}
	return s.UpdateTrafficWeights(ctx, appID, weights, actorID, "user")
}

func (s *Service) SyncTrafficRoute(ctx context.Context, routeID uuid.UUID) error {
	route, err := s.queries.GetTrafficRoute(ctx, routeID)
	if err != nil {
		return fmt.Errorf("get route: %w", err)
	}
	app, err := s.queries.GetApp(ctx, route.AppID)
	if err != nil {
		return fmt.Errorf("get app: %w", err)
	}
	project, err := s.queries.GetProject(ctx, app.ProjectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}
	backends, err := s.queries.ListTrafficBackendsForSync(ctx, route.ID)
	if err != nil {
		return fmt.Errorf("list route backends: %w", err)
	}
	if len(backends) == 0 {
		return nil
	}

	type group struct {
		name   string
		weight int32
		urls   []string
	}
	groupsByServer := map[uuid.UUID][]group{}
	agentByServer := map[uuid.UUID]string{}
	for _, backend := range backends {
		targets, err := s.queries.ListDeploymentTargets(ctx, backend.DeploymentID)
		if err != nil {
			continue
		}
		for _, target := range targets {
			if target.Status != "healthy" {
				continue
			}
			server, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: target.ServerID, TeamID: project.TeamID})
			if err != nil || server.AgentID == nil {
				continue
			}
			agentByServer[target.ServerID] = *server.AgentID
			containerName := fmt.Sprintf("nixway-%s-%s", app.Slug, backend.DeploymentID.String()[:8])
			groupsByServer[target.ServerID] = append(groupsByServer[target.ServerID], group{
				name:   trafficServiceName(app.Slug, backend.Label, backend.DeploymentID),
				weight: backend.Weight,
				urls:   []string{fmt.Sprintf("http://%s:%d", containerName, app.Port)},
			})
		}
	}

	domains := trafficDomains(app, route)
	for serverID, groups := range groupsByServer {
		agentID := agentByServer[serverID]
		if agentID == "" {
			continue
		}
		cmdGroups := make([]*agentv1.TrafficBackendGroup, 0, len(groups))
		for _, group := range groups {
			cmdGroups = append(cmdGroups, &agentv1.TrafficBackendGroup{
				Name:   group.name,
				Weight: group.weight,
				Urls:   group.urls,
			})
		}
		if err := s.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
			Payload: &agentv1.ControlMessage_TrafficRoute{
				TrafficRoute: &agentv1.TrafficRouteCommand{
					RequestId: uuid.New().String(),
					AppSlug:   app.Slug,
					Domains:   domains,
					Tls:       false,
					Groups:    cmdGroups,
				},
			},
		}); err != nil {
			s.logger.Warn("traffic route sync failed", "server", serverID, "error", err)
		}
	}
	return nil
}

func (s *Service) EvaluateAutoscaling(ctx context.Context, appID uuid.UUID) ([]AutoscaleEvaluation, error) {
	app, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("get app: %w", err)
	}
	rules, err := s.queries.ListEnabledAutoscalingRulesByApp(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("list autoscaling rules: %w", err)
	}
	metrics, err := s.queries.GetAverageMetricsForApp(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("get metrics: %w", err)
	}

	results := make([]AutoscaleEvaluation, 0, len(rules))
	for _, rule := range rules {
		value, ok := metricValue(rule.MetricName, metrics)
		result := AutoscaleEvaluation{
			RuleID:      rule.ID,
			RuleName:    rule.Name,
			MetricName:  rule.MetricName,
			MetricValue: value,
		}
		if !ok || metrics.SampleCount == 0 {
			result.Message = "waiting for fresh agent metrics"
			results = append(results, result)
			continue
		}
		if !comparisonMatches(value, rule.Comparison, rule.Threshold) {
			result.Message = "condition not met"
			results = append(results, result)
			continue
		}

		target := autoscaleTarget(app.Replicas, rule)
		if target == app.Replicas {
			result.Message = "already at scaling bound"
			results = append(results, result)
			continue
		}
		if rule.LastTriggeredAt.Valid {
			cooldown := time.Duration(rule.CooldownUpSeconds) * time.Second
			if target < app.Replicas {
				cooldown = time.Duration(rule.CooldownDownSeconds) * time.Second
			}
			if time.Since(rule.LastTriggeredAt.Time) < cooldown {
				result.Message = "cooldown active"
				results = append(results, result)
				continue
			}
		}

		metricName := rule.MetricName
		ruleName := rule.Name
		scale, err := s.ScaleApp(ctx, appID, ScaleRequest{
			Replicas:             target,
			PlacementStrategy:    app.PlacementStrategy,
			PlacementConstraints: scheduler.ParseConstraints(app.PlacementConstraints),
			PinnedServerIDs:      app.PinnedServerIds,
			ActorType:            "autoscaler",
			EventType:            "autoscale",
			MetricName:           &metricName,
			MetricValue:          &value,
			RuleName:             &ruleName,
		})
		if err != nil {
			result.Message = err.Error()
			results = append(results, result)
			continue
		}
		_ = s.queries.MarkAutoscalingRuleTriggered(ctx, rule.ID)
		result.Triggered = true
		result.Event = &scale.Event
		result.Message = fmt.Sprintf("scaled from %d to %d", app.Replicas, target)
		results = append(results, result)
		app.Replicas = target
	}
	return results, nil
}

func metricValue(name string, metrics db.GetAverageMetricsForAppRow) (float64, bool) {
	switch name {
	case "cpu_percent":
		return metrics.CpuPercent, true
	case "memory_percent":
		return metrics.MemoryPercent, true
	default:
		return 0, false
	}
}

func comparisonMatches(value float64, comparison string, threshold float64) bool {
	switch comparison {
	case "gt":
		return value > threshold
	case "gte":
		return value >= threshold
	case "lt":
		return value < threshold
	case "lte":
		return value <= threshold
	default:
		return false
	}
}

func autoscaleTarget(current int32, rule db.AutoscalingRule) int32 {
	target := current
	switch rule.ActionType {
	case "scale_to":
		target = rule.ActionValue
	default:
		target = current + rule.ActionValue
	}
	if target < rule.MinReplicas {
		target = rule.MinReplicas
	}
	if target > rule.MaxReplicas {
		target = rule.MaxReplicas
	}
	return target
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

	cmd := &agentv1.DeployCommand{
		DeployId:                   deployID,
		TargetId:                   targetID,
		ImageTag:                   build.ImageTag,
		ContainerName:              containerName,
		Port:                       app.Port,
		Env:                        envVars,
		HealthCheckPath:            app.HealthCheckPath,
		HealthCheckIntervalSeconds: app.HealthCheckInterval,
		HealthCheckTimeoutSeconds:  app.HealthCheckTimeout,
		Traefik: &agentv1.TraefikConfig{
			AppSlug: app.Slug,
			Domains: domains,
			Tls:     false,
			Port:    app.Port,
		},
		MemoryLimitMb:      app.MemoryLimitMb,
		CpuLimitMillicores: app.CpuLimitMillicores,
		Labels: map[string]string{
			"nixway.managed":        "true",
			"nixway.app_id":         app.ID.String(),
			"nixway.app_slug":       app.Slug,
			"nixway.project_id":     project.ID.String(),
			"nixway.cluster_id":     project.ClusterID.String(),
			"nixway.deployment_id":  deployment.ID.String(),
			"nixway.target_id":      targetID,
			"nixway.environment_id": deployment.EnvironmentID.String(),
		},
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
					ContainerName:  *c.ContainerID,
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
