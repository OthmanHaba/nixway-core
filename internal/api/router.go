package api

import (
	"log/slog"
	"net/http"

	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/agent"
	"github.com/othmanhaba/nixway-core/internal/api/handler"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/app"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/othmanhaba/nixway-core/internal/build"
	"github.com/othmanhaba/nixway-core/internal/cluster"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/containerlog"
	"github.com/othmanhaba/nixway-core/internal/database"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/deploy"
	"github.com/othmanhaba/nixway-core/internal/email"
	githubsvc "github.com/othmanhaba/nixway-core/internal/github"
	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/othmanhaba/nixway-core/internal/observability"
	"github.com/othmanhaba/nixway-core/internal/platform"
	"github.com/othmanhaba/nixway-core/internal/project"
	"github.com/othmanhaba/nixway-core/internal/provisioner"
	"github.com/othmanhaba/nixway-core/internal/registry"
	"github.com/othmanhaba/nixway-core/internal/secret"
	"github.com/othmanhaba/nixway-core/internal/server"
	"github.com/othmanhaba/nixway-core/internal/template"
	"github.com/othmanhaba/nixway-core/internal/volume"
)

func NewRouter(
	queries *db.Queries,
	sessions *auth.SessionManager,
	emailSender email.Sender,
	auditWriter *audit.Writer,
	cfg *config.Config,
	logger *slog.Logger,
	redisClient *redis.Client,
	masterKey [32]byte,
	onboardingSvc *server.OnboardingService,
	provisionSvc *provisioner.Service,
	clusterSvc *cluster.Service,
	connMgr *agent.ConnManager,
	meshMgr *mesh.Manager,
	githubService *githubsvc.Service,
	secretSvc *secret.Service,
	projectSvc *project.Service,
	appSvc *app.Service,
	buildSvc *build.Service,
	deploySvc *deploy.Service,
	containerLogSvc *containerlog.Service,
	observabilitySvc *observability.Service,
	templateRegistry *template.Registry,
	volumeSvc *volume.Service,
	minioClient *platform.MinIOClient,
	databaseSvc *database.Service,
) http.Handler {
	authH := handler.NewAuthHandler(queries, sessions, emailSender, auditWriter, cfg, logger)
	teamH := handler.NewTeamHandler(queries, emailSender, auditWriter, cfg, logger)
	tokenH := handler.NewTokenHandler(queries, auditWriter, cfg, logger)
	auditH := handler.NewAuditLogHandler(queries, logger)
	sshKeyH := handler.NewSSHKeyHandler(queries, auditWriter, logger, masterKey)
	serverH := handler.NewServerHandler(queries, auditWriter, onboardingSvc, connMgr, redisClient, logger)
	tagH := handler.NewTagHandler(queries, logger)
	provisionH := handler.NewProvisionHandler(queries, redisClient, auditWriter, provisionSvc, logger)
	discoverH := handler.NewDiscoveryHandler(logger)
	clusterH := handler.NewClusterHandler(queries, auditWriter, clusterSvc, meshMgr, redisClient, observabilitySvc, logger)
	agentDlH := handler.NewAgentDownloadHandler(cfg.Server.AgentBinaryDir, logger)
	terminalH := handler.NewTerminalHandler(queries, logger, masterKey)
	githubH := handler.NewGitHubHandler(queries, auditWriter, githubService, masterKey, logger)
	webhookH := handler.NewWebhookHandler(queries, buildSvc, masterKey, logger)
	registryH := handler.NewRegistryHandler(queries, auditWriter, registry.NewValidator(), masterKey, logger)
	secretH := handler.NewSecretHandler(queries, auditWriter, secretSvc, logger)
	projectH := handler.NewProjectHandler(queries, auditWriter, projectSvc, logger)
	appH := handler.NewAppHandler(queries, auditWriter, appSvc, logger)
	buildH := handler.NewBuildHandler(queries, buildSvc, redisClient, logger)
	deployH := handler.NewDeployHandler(queries, deploySvc, connMgr, redisClient, containerLogSvc, logger)
	containerTermH := handler.NewContainerTerminalHandler(queries, connMgr, redisClient, logger)
	observabilityH := handler.NewObservabilityHandler(queries, observabilitySvc, logger)
	templateH := handler.NewTemplateHandler(templateRegistry, logger)
	volumeH := handler.NewVolumeHandler(queries, volumeSvc, logger)
	platformStorageH := handler.NewPlatformStorageHandler(minioClient, cfg.PlatformStorage)
	databaseH := handler.NewDatabaseHandler(queries, databaseSvc, redisClient, auditWriter, logger)
	dbToolingH := handler.NewDBToolingHandler(queries, databaseSvc, connMgr, redisClient, templateRegistry, auditWriter, logger)

	mux := http.NewServeMux()

	// Public routes
	mux.HandleFunc("GET /agent/download/{arch}", agentDlH.Download)
	mux.HandleFunc("POST /api/v1/auth/signup", authH.Signup)
	mux.HandleFunc("POST /api/v1/auth/login", authH.Login)
	mux.HandleFunc("POST /api/v1/auth/verify-email", authH.VerifyEmail)
	mux.HandleFunc("POST /api/v1/auth/forgot-password", authH.ForgotPassword)
	mux.HandleFunc("POST /api/v1/auth/reset-password", authH.ResetPassword)

	// Public webhook route (no auth)
	mux.HandleFunc("POST /api/v1/webhooks/github/{appId}", webhookH.HandleGitHub)
	mux.HandleFunc("POST /api/v1/webhooks/github/team/{teamId}", webhookH.HandleGitHubTeam)

	// Protected routes — use a separate mux wrapped with auth middleware
	protected := http.NewServeMux()

	// Auth (protected)
	protected.HandleFunc("POST /api/v1/auth/logout", authH.Logout)
	protected.HandleFunc("GET /api/v1/auth/me", authH.Me)

	// Teams
	protected.HandleFunc("POST /api/v1/teams", teamH.Create)
	protected.HandleFunc("GET /api/v1/teams", teamH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}", teamH.Get)
	protected.HandleFunc("PUT /api/v1/teams/{id}", teamH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{id}", teamH.Delete)

	// Team members
	protected.HandleFunc("GET /api/v1/teams/{id}/members", teamH.ListMembers)
	protected.HandleFunc("PUT /api/v1/teams/{id}/members/{userID}", teamH.UpdateMember)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/members/{userID}", teamH.RemoveMember)

	// Team invites
	protected.HandleFunc("POST /api/v1/teams/{id}/invites", teamH.CreateInvite)
	protected.HandleFunc("GET /api/v1/teams/{id}/invites", teamH.ListInvites)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/invites/{inviteID}", teamH.CancelInvite)

	// Accept invite (not team-scoped)
	protected.HandleFunc("POST /api/v1/invites/accept", teamH.AcceptInvite)

	// API tokens
	protected.HandleFunc("POST /api/v1/teams/{id}/tokens", tokenH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/tokens", tokenH.List)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/tokens/{tokenID}", tokenH.Revoke)

	// Audit logs
	protected.HandleFunc("GET /api/v1/teams/{id}/audit-logs", auditH.List)

	// SSH keys
	protected.HandleFunc("POST /api/v1/teams/{id}/ssh-keys", sshKeyH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/ssh-keys", sshKeyH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}/ssh-keys/{keyID}", sshKeyH.Get)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/ssh-keys/{keyID}", sshKeyH.Delete)

	// Servers
	protected.HandleFunc("POST /api/v1/teams/{id}/servers", serverH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/servers", serverH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}", serverH.Get)
	protected.HandleFunc("PUT /api/v1/teams/{id}/servers/{serverId}", serverH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/servers/{serverId}", serverH.Delete)
	protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/cleanup", serverH.Cleanup)

	// Server tags
	protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/tags", tagH.List)
	protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/tags", tagH.Set)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/servers/{serverId}/tags/{key}", tagH.Delete)

	// Provisioning
	protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/provision", provisionH.Start)
	protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/provision", provisionH.Status)
	protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/provision/{jobId}/logs", provisionH.StreamLogs)
	protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/provision/retry", provisionH.Retry)

	// Terminal (WebSocket)
	protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/terminal", terminalH.Connect)

	// Clusters
	protected.HandleFunc("POST /api/v1/teams/{id}/clusters", clusterH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters", clusterH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}", clusterH.Get)
	protected.HandleFunc("PUT /api/v1/teams/{id}/clusters/{clusterId}", clusterH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/clusters/{clusterId}", clusterH.Delete)

	// Cluster members
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/members", clusterH.ListMembers)
	protected.HandleFunc("POST /api/v1/teams/{id}/clusters/{clusterId}/members", clusterH.AddMember)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}", clusterH.RemoveMember)

	// Mesh health + events + logs
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/mesh", clusterH.MeshHealth)
	protected.HandleFunc("POST /api/v1/teams/{id}/clusters/{clusterId}/mesh/regenerate", clusterH.RegenerateMesh)
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/mesh/logs", clusterH.StreamMeshLogs)
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/events", clusterH.ListEvents)

	// GitHub App
	protected.HandleFunc("POST /api/v1/teams/{id}/github/manifest", githubH.CreateManifest)
	protected.HandleFunc("POST /api/v1/teams/{id}/github/callback", githubH.HandleCallback)
	protected.HandleFunc("GET /api/v1/teams/{id}/github/app", githubH.GetApp)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/github/app", githubH.DeleteApp)
	protected.HandleFunc("GET /api/v1/teams/{id}/github/installations", githubH.ListInstallations)
	protected.HandleFunc("POST /api/v1/teams/{id}/github/installations/sync", githubH.SyncInstallations)
	protected.HandleFunc("GET /api/v1/teams/{id}/github/installations/{installationId}/repos", githubH.ListRepos)

	// Container registries
	protected.HandleFunc("POST /api/v1/teams/{id}/registries", registryH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/registries", registryH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}/registries/{registryId}", registryH.Get)
	protected.HandleFunc("PUT /api/v1/teams/{id}/registries/{registryId}", registryH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/registries/{registryId}", registryH.Delete)
	protected.HandleFunc("POST /api/v1/teams/{id}/registries/{registryId}/validate", registryH.Revalidate)

	// Secrets
	protected.HandleFunc("POST /api/v1/teams/{id}/secrets", secretH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/secrets", secretH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}/secrets/{secretId}", secretH.Get)
	protected.HandleFunc("POST /api/v1/teams/{id}/secrets/{secretId}/reveal", secretH.Reveal)
	protected.HandleFunc("PUT /api/v1/teams/{id}/secrets/{secretId}", secretH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/secrets/{secretId}", secretH.Delete)

	// Projects
	protected.HandleFunc("POST /api/v1/teams/{teamId}/projects", projectH.Create)
	protected.HandleFunc("GET /api/v1/teams/{teamId}/projects", projectH.List)
	protected.HandleFunc("GET /api/v1/teams/{teamId}/projects/{projectId}", projectH.Get)
	protected.HandleFunc("PUT /api/v1/teams/{teamId}/projects/{projectId}", projectH.Update)
	protected.HandleFunc("DELETE /api/v1/teams/{teamId}/projects/{projectId}", projectH.Delete)

	// Environments
	protected.HandleFunc("POST /api/v1/projects/{projectId}/environments", projectH.CreateEnvironment)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/environments", projectH.ListEnvironments)

	// Apps
	protected.HandleFunc("POST /api/v1/projects/{projectId}/apps", appH.Create)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/apps", appH.List)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/apps/{appId}", appH.Get)
	protected.HandleFunc("PUT /api/v1/projects/{projectId}/apps/{appId}", appH.Update)
	protected.HandleFunc("DELETE /api/v1/projects/{projectId}/apps/{appId}", appH.Delete)

	// App (direct by ID, no projectId needed)
	protected.HandleFunc("GET /api/v1/apps/{appId}", appH.GetDirect)
	protected.HandleFunc("POST /api/v1/apps/{appId}/domain", appH.SetDomain)
	protected.HandleFunc("POST /api/v1/apps/{appId}/domain/verify", appH.VerifyDomain)

	// Builds
	protected.HandleFunc("POST /api/v1/apps/{appId}/builds", buildH.TriggerBuild)
	protected.HandleFunc("GET /api/v1/apps/{appId}/builds", buildH.List)
	protected.HandleFunc("GET /api/v1/apps/{appId}/builds/{buildId}", buildH.Get)
	protected.HandleFunc("GET /api/v1/apps/{appId}/builds/{buildId}/logs", buildH.StreamLogs)

	// Deployments
	protected.HandleFunc("POST /api/v1/apps/{appId}/deployments", deployH.TriggerDeploy)
	protected.HandleFunc("GET /api/v1/apps/{appId}/deployments", deployH.List)
	protected.HandleFunc("GET /api/v1/apps/{appId}/deployments/{deployId}", deployH.Get)
	protected.HandleFunc("GET /api/v1/apps/{appId}/deployments/{deployId}/logs", deployH.StreamLogs)
	protected.HandleFunc("GET /api/v1/apps/{appId}/deployments/{deployId}/targets", deployH.ListTargets)
	protected.HandleFunc("POST /api/v1/apps/{appId}/rollback", deployH.Rollback)
	protected.HandleFunc("POST /api/v1/apps/{appId}/scale", deployH.ScaleApp)
	protected.HandleFunc("GET /api/v1/apps/{appId}/scaling-events", deployH.ListScalingEvents)
	protected.HandleFunc("POST /api/v1/apps/{appId}/autoscaling-rules", deployH.CreateAutoscalingRule)
	protected.HandleFunc("GET /api/v1/apps/{appId}/autoscaling-rules", deployH.ListAutoscalingRules)
	protected.HandleFunc("DELETE /api/v1/apps/{appId}/autoscaling-rules/{ruleId}", deployH.DeleteAutoscalingRule)
	protected.HandleFunc("POST /api/v1/apps/{appId}/autoscaling/evaluate", deployH.EvaluateAutoscaling)
	protected.HandleFunc("GET /api/v1/apps/{appId}/traffic", deployH.GetTraffic)
	protected.HandleFunc("PUT /api/v1/apps/{appId}/traffic", deployH.UpdateTraffic)
	protected.HandleFunc("POST /api/v1/apps/{appId}/traffic/backends/{backendId}/promote", deployH.PromoteTrafficBackend)
	protected.HandleFunc("GET /api/v1/apps/{appId}/logs", deployH.ContainerLogs)
	protected.HandleFunc("POST /api/v1/apps/{appId}/cleanup", deployH.CleanupDeployments)

	// Container lifecycle + inspect
	protected.HandleFunc("GET /api/v1/apps/{appId}/replicas", deployH.ListReplicas)
	protected.HandleFunc("POST /api/v1/apps/{appId}/containers/{containerName}/restart", deployH.RestartContainer)
	protected.HandleFunc("POST /api/v1/apps/{appId}/containers/{containerName}/stop", deployH.StopContainer)
	protected.HandleFunc("GET /api/v1/apps/{appId}/containers/{containerName}/inspect", deployH.InspectContainer)

	// Historical logs + search
	protected.HandleFunc("GET /api/v1/apps/{appId}/logs/search", deployH.SearchLogs)
	protected.HandleFunc("GET /api/v1/apps/{appId}/logs/history", deployH.HistoricalLogs)

	// Resource limits
	protected.HandleFunc("PUT /api/v1/apps/{appId}/resources", appH.UpdateResources)

	// Container terminal (WebSocket)
	protected.HandleFunc("GET /api/v1/apps/{appId}/terminal", containerTermH.Connect)

	// Server logs (SSE)
	protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/logs", deployH.ServerLogs)

	// Observability
	protected.HandleFunc("GET /api/v1/teams/{id}/observability/metrics", observabilityH.Metrics)
	protected.HandleFunc("GET /api/v1/teams/{id}/observability/alerts", observabilityH.ListAlerts)
	protected.HandleFunc("POST /api/v1/teams/{id}/observability/alerts", observabilityH.CreateAlert)
	protected.HandleFunc("PUT /api/v1/teams/{id}/observability/alerts/{alertId}", observabilityH.UpdateAlert)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/observability/alerts/{alertId}", observabilityH.DeleteAlert)
	protected.HandleFunc("POST /api/v1/teams/{id}/observability/alerts/evaluate", observabilityH.EvaluateAlerts)
	protected.HandleFunc("GET /api/v1/teams/{id}/observability/events", observabilityH.Events)
	protected.HandleFunc("GET /api/v1/teams/{id}/observability/channels", observabilityH.ListChannels)
	protected.HandleFunc("POST /api/v1/teams/{id}/observability/channels", observabilityH.CreateChannel)
	protected.HandleFunc("POST /api/v1/teams/{id}/observability/silences", observabilityH.CreateSilence)
	protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/observability/scrape-config", observabilityH.ClusterScrapeConfig)
	protected.HandleFunc("POST /api/v1/teams/{id}/clusters/{clusterId}/observability/scrape-config/sync", observabilityH.SyncClusterScrapeConfig)

	// Service templates (platform-wide catalog, read-only)
	protected.HandleFunc("GET /api/v1/templates", templateH.List)
	protected.HandleFunc("GET /api/v1/templates/{slug}", templateH.Get)
	protected.HandleFunc("GET /api/v1/templates/{slug}/versions", templateH.ListVersions)

	// Volumes
	protected.HandleFunc("POST /api/v1/teams/{id}/volumes", volumeH.Create)
	protected.HandleFunc("GET /api/v1/teams/{id}/volumes", volumeH.List)
	protected.HandleFunc("GET /api/v1/teams/{id}/volumes/{volumeId}", volumeH.Get)
	protected.HandleFunc("DELETE /api/v1/teams/{id}/volumes/{volumeId}", volumeH.Delete)
	protected.HandleFunc("POST /api/v1/teams/{id}/volumes/{volumeId}/attach", volumeH.Attach)
	protected.HandleFunc("POST /api/v1/teams/{id}/volumes/{volumeId}/detach", volumeH.Detach)
	protected.HandleFunc("POST /api/v1/teams/{id}/volumes/{volumeId}/move", volumeH.Move)
	protected.HandleFunc("POST /api/v1/teams/{id}/volumes/{volumeId}/snapshot", volumeH.Snapshot)
	protected.HandleFunc("POST /api/v1/teams/{id}/volumes/{volumeId}/resize", volumeH.Resize)
	protected.HandleFunc("GET /api/v1/teams/{id}/volumes/{volumeId}/snapshots", volumeH.ListSnapshots)

	// Databases (project-scoped, managed services)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases", databaseH.Provision)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases", databaseH.List)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases/{databaseId}", databaseH.Get)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases/{databaseId}/provision-stream", databaseH.StreamProvisionLogs)
	protected.HandleFunc("DELETE /api/v1/projects/{projectId}/databases/{databaseId}", databaseH.Delete)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/stop", databaseH.Stop)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/start", databaseH.Start)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/rebind-volume", databaseH.RebindVolume)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/links", databaseH.LinkDatabase)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases/{databaseId}/links", databaseH.ListLinks)
	protected.HandleFunc("DELETE /api/v1/projects/{projectId}/databases/{databaseId}/links/{linkId}", databaseH.UnlinkDatabase)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/rotate", databaseH.RotateCredentials)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases/{databaseId}/rotations", databaseH.ListRotations)

	// Database backups + restore (Phase 8.7)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/backups", databaseH.CreateBackup)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases/{databaseId}/backups", databaseH.ListBackups)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/databases/{databaseId}/backups/{backupId}", databaseH.GetBackup)
	protected.HandleFunc("DELETE /api/v1/projects/{projectId}/databases/{databaseId}/backups/{backupId}", databaseH.DeleteBackup)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/databases/{databaseId}/restore", databaseH.Restore)

	// Database tooling (terminal, table browser, query runner, redis/mongo inspector, saved queries)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}", databaseH.GetByID)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/terminal", dbToolingH.Terminal)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/schemas", dbToolingH.ListSchemas)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/schemas/{schema}/tables", dbToolingH.ListTables)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/schemas/{schema}/tables/{table}/rows", dbToolingH.GetTableRows)
	protected.HandleFunc("POST /api/v1/databases/{databaseId}/query", dbToolingH.RunQuery)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/query-history", dbToolingH.ListQueryHistory)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/redis/keys", dbToolingH.RedisListKeys)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/redis/key", dbToolingH.RedisGetKey)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/redis/info", dbToolingH.RedisInfo)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/redis/config", dbToolingH.RedisConfig)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/mongo/collections", dbToolingH.MongoListCollections)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/mongo/collections/{collection}/find", dbToolingH.MongoFind)
	protected.HandleFunc("GET /api/v1/databases/{databaseId}/mongo/collections/{collection}/doc", dbToolingH.MongoGetDocument)
	protected.HandleFunc("POST /api/v1/projects/{projectId}/saved-queries", dbToolingH.SaveQuery)
	protected.HandleFunc("GET /api/v1/projects/{projectId}/saved-queries", dbToolingH.ListSavedQueriesByProject)

	// Discovery
	protected.HandleFunc("POST /api/v1/discover", discoverH.Discover)

	// Platform admin (read-only operator endpoints)
	protected.HandleFunc("GET /api/v1/admin/platform/storage/status", platformStorageH.Status)

	// Mount protected routes behind auth middleware
	authMW := middleware.Auth(queries, sessions)
	mux.Handle("/api/v1/auth/logout", authMW(protected))
	mux.Handle("/api/v1/auth/me", authMW(protected))
	mux.Handle("/api/v1/teams", authMW(protected))
	mux.Handle("/api/v1/teams/", authMW(protected))
	mux.Handle("/api/v1/invites/", authMW(protected))
	mux.Handle("/api/v1/projects/", authMW(protected))
	mux.Handle("/api/v1/apps/", authMW(protected))
	mux.Handle("/api/v1/discover", authMW(protected))
	mux.Handle("/api/v1/templates", authMW(protected))
	mux.Handle("/api/v1/templates/", authMW(protected))
	mux.Handle("/api/v1/admin/", authMW(protected))
	mux.Handle("/api/v1/databases/", authMW(protected))

	// Health check
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		respond.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Apply global middleware chain
	corsConfig := middleware.CORSConfig{
		AllowedOrigins: []string{cfg.Email.BaseURL, "http://localhost:5173"},
	}

	var h http.Handler = mux
	h = middleware.CORS(corsConfig)(h)
	h = middleware.Recover(logger)(h)
	h = middleware.Logging(logger)(h)
	h = middleware.RequestID(h)

	return h
}
