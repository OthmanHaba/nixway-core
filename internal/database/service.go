package database

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/dns"
	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/othmanhaba/nixway-core/internal/platform"
	"github.com/othmanhaba/nixway-core/internal/secret"
	"github.com/othmanhaba/nixway-core/internal/template"
	"github.com/othmanhaba/nixway-core/internal/volume"
)

// ProvisionChannel returns the Redis pub/sub channel used to stream
// provision-progress events for a single database. The SSE handler subscribes
// here; service code publishes via publishProvision.
func ProvisionChannel(dbID uuid.UUID) string {
	return "db-provision:" + dbID.String()
}

// ProvisionEvent is one progress line emitted while a database is being
// provisioned. It is JSON-encoded and shipped over Redis pub/sub.
type ProvisionEvent struct {
	Step     string `json:"step"`
	Level    string `json:"level"`
	Message  string `json:"message"`
	Terminal bool   `json:"terminal,omitempty"`
	Success  bool   `json:"success,omitempty"`
}

// Status state machine values for the databases.status column.
const (
	StatusProvisioning = "provisioning"
	StatusRunning      = "running"
	StatusStopped      = "stopped"
	StatusError        = "error"
	StatusDeleted      = "deleted"
)

// healthCheckTimeout caps how long we wait for the agent to report a healthy
// container after sending DeployCommand. The DeployCommand carries its own
// retries/timeout, so this is the outer bound for the whole orchestration.
const healthCheckTimeout = 90 * time.Second

// RedeployTrigger triggers a fresh deploy of an app's last-healthy build into
// its production environment. Implemented by deploy.Service. Kept as an
// interface to break the import cycle (deploy depends on database for
// BuildEnvForApp; database depends on deploy for redeploy after rotation).
type RedeployTrigger interface {
	RedeployAppLatest(ctx context.Context, appID uuid.UUID) (db.Deployment, error)
}

// Service orchestrates database provisioning, lifecycle, and credential storage.
type Service struct {
	queries     *db.Queries
	volumeSvc   *volume.Service
	templateReg *template.Registry
	secretSvc   *secret.Service
	connMgr     *agent.ConnManager
	meshMgr     *mesh.Manager
	minio       *platform.MinIOClient // may be nil — backup endpoints fail with a clear error if so
	redeployer  RedeployTrigger
	logger      *slog.Logger

	// redis is used for per-user query rate limiting in the tooling UI.
	// May be nil; callers handle the no-Redis case.
	redis *redis.Client

	mu               sync.Mutex
	pendingAlterUser map[string]chan *agentv1.DatabaseAlterUserResult
	pendingQuery     map[string]chan *agentv1.DatabaseQueryResult
	pendingRestore   map[string]chan *agentv1.RestoreResult
	pendingDeploy    map[string]chan *agentv1.DeployOutput
}

// NewService constructs the database orchestrator. The mesh manager may be
// nil in narrow contexts (e.g. unit tests that exercise non-DNS paths); the
// service guards every call before pushing DNS. The MinIO client may also be
// nil — backup endpoints will return a clear "not configured" error in that
// case but the rest of the service still functions.
func NewService(
	queries *db.Queries,
	volumeSvc *volume.Service,
	templateReg *template.Registry,
	secretSvc *secret.Service,
	connMgr *agent.ConnManager,
	meshMgr *mesh.Manager,
	minioClient *platform.MinIOClient,
	logger *slog.Logger,
) *Service {
	s := &Service{
		queries:          queries,
		volumeSvc:        volumeSvc,
		templateReg:      templateReg,
		secretSvc:        secretSvc,
		connMgr:          connMgr,
		meshMgr:          meshMgr,
		minio:            minioClient,
		logger:           logger,
		pendingAlterUser: make(map[string]chan *agentv1.DatabaseAlterUserResult),
		pendingQuery:     make(map[string]chan *agentv1.DatabaseQueryResult),
		pendingRestore:   make(map[string]chan *agentv1.RestoreResult),
		pendingDeploy:    make(map[string]chan *agentv1.DeployOutput),
	}
	// Register ourselves as an ExtraRecordProvider so the mesh manager
	// includes our DB hosts on every cluster DNS push (mesh regen, member
	// changes, our own provision/delete pushes).
	if meshMgr != nil {
		meshMgr.RegisterExtraProvider(s)
	}
	return s
}

// SetRedeployTrigger wires the deploy service callback used by credential
// rotation to roll linked apps after the password change. Called after both
// services are constructed to break the import cycle. Safe to leave nil in
// narrow tests; rotation will then skip the redeploy step.
func (s *Service) SetRedeployTrigger(r RedeployTrigger) {
	s.redeployer = r
}

// HostsForCluster implements mesh.ExtraRecordProvider. Returns a hosts entry
// for every running database in the cluster, mapped to its host server's
// WireGuard IP. Used by the mesh manager when regenerating the cluster's
// CoreDNS hosts file. Cross-cluster isolation is enforced here: only DBs in
// the requested cluster ever appear in the result.
func (s *Service) HostsForCluster(ctx context.Context, clusterID uuid.UUID) ([]dns.Record, error) {
	dbs, err := s.queries.ListDatabasesByCluster(ctx, clusterID)
	if err != nil {
		return nil, fmt.Errorf("list databases in cluster: %w", err)
	}
	// Build serverID -> wg IP lookup once.
	members, err := s.queries.GetClusterMembersForMesh(ctx, clusterID)
	if err != nil {
		return nil, fmt.Errorf("list cluster members: %w", err)
	}
	wgByServer := make(map[uuid.UUID]string, len(members))
	for _, m := range members {
		wgByServer[m.ServerID] = m.WireguardIp.String()
	}

	out := make([]dns.Record, 0, len(dbs))
	for _, d := range dbs {
		if d.Status == StatusDeleted || d.DnsRecord == nil || *d.DnsRecord == "" {
			continue
		}
		ip, ok := wgByServer[d.ServerID]
		if !ok || ip == "" {
			continue
		}
		out = append(out, dns.Record{Hostname: *d.DnsRecord, IP: ip})
	}
	return out, nil
}

// ProvisionRequest carries every input needed to spin up a managed database.
type ProvisionRequest struct {
	TeamID         uuid.UUID
	ProjectID      uuid.UUID
	ClusterID      uuid.UUID
	ServerID       *uuid.UUID // nil = scheduler picks server with lowest DB count
	TemplateSlug   string
	Version        string
	Name           string // optional; auto-generated when empty
	SizeGB         int
	CPUMillicores  int    // 0 = template default
	MemoryMB       int    // 0 = template default
	BackupSchedule string // cron expression; "" = no scheduled backup
	RetentionDays  int    // 0 = default 7
}

// ProvisionResult is the response to a successful Provision call. The
// passwords are returned plaintext exactly once — the caller (HTTP handler)
// is responsible for displaying them in a reveal-once UI and never echoing
// them to logs.
type ProvisionResult struct {
	Database          db.Database `json:"database"`
	SuperuserPassword string      `json:"superuser_password"`
	AppUserPassword   string      `json:"appuser_password"`
}

// Provision runs the end-to-end DB provisioning flow. The synchronous portion
// validates inputs, generates credentials, creates the volume, stores
// secrets, and inserts the database row in the `provisioning` state — then
// returns the credentials to the caller. The remaining work (sending the
// DeployCommand, waiting for the container, updating DNS) runs in a
// goroutine and publishes progress to ProvisionChannel(dbID) so the UI can
// stream a live console.
//
// Sync flow:
//  1. Validate template + version, defaults
//  2. Resolve placement (user-pinned or scheduler)
//  3. Generate name, container name, credentials
//  4. Create volume on the chosen server
//  5. Persist credentials in the secrets store (reveal-once)
//  6. Insert database row with status=provisioning
//
// Async flow (in goroutine, all events published):
//  7. Build env, send DeployCommand to agent
//  8. Update DNS record + push CoreDNS hosts
//  9. Mark row running (success) or error (failure)
//
// Failure handling: any sync error returns immediately; async errors mark
// the row error and emit a terminal=true,success=false event.
func (s *Service) Provision(ctx context.Context, req ProvisionRequest) (*ProvisionResult, error) {
	tmpl, ok := s.templateReg.Get(req.TemplateSlug)
	if !ok {
		return nil, fmt.Errorf("template not found: %s", req.TemplateSlug)
	}
	version, err := s.templateReg.GetVersion(req.TemplateSlug, req.Version)
	if err != nil {
		return nil, err
	}

	if req.SizeGB <= 0 {
		req.SizeGB = tmpl.VolumeSpec.DefaultGiB
	}
	if req.SizeGB <= 0 {
		req.SizeGB = 10
	}
	if req.CPUMillicores <= 0 {
		req.CPUMillicores = tmpl.DefaultResources.MilliCPU
	}
	if req.MemoryMB <= 0 {
		req.MemoryMB = tmpl.DefaultResources.MemoryMB
	}
	if req.RetentionDays <= 0 {
		req.RetentionDays = 7
	}

	project, err := s.queries.GetProject(ctx, req.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}
	if project.TeamID != req.TeamID {
		return nil, errors.New("project does not belong to team")
	}

	serverID, err := s.resolvePlacement(ctx, req.TeamID, req.ClusterID, req.ServerID)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		suffix, err := randomSuffix(3)
		if err != nil {
			return nil, fmt.Errorf("generate name: %w", err)
		}
		name = fmt.Sprintf("%s-%s", req.TemplateSlug, suffix)
	}

	projectSlug := project.Slug
	if projectSlug == "" {
		projectSlug = project.ID.String()[:8]
	}
	containerName := fmt.Sprintf("nw-db-%s-%s", projectSlug, name)

	superPass, err := GeneratePassword()
	if err != nil {
		return nil, fmt.Errorf("generate superuser password: %w", err)
	}
	appPass, err := GeneratePassword()
	if err != nil {
		return nil, fmt.Errorf("generate app password: %w", err)
	}

	vol, err := s.volumeSvc.Create(ctx, volume.CreateRequest{
		TeamID:    req.TeamID,
		ClusterID: req.ClusterID,
		ServerID:  serverID,
		Name:      "db-" + name,
		SizeGB:    int32(req.SizeGB),
	})
	if err != nil {
		return nil, fmt.Errorf("create volume: %w", err)
	}

	superSecretID, appSecretID, err := s.secretSvc.CreateDatabaseSecrets(ctx, req.TeamID, req.ProjectID, name, superPass, appPass)
	if err != nil {
		// Roll back the volume so a failed credential write doesn't leak disk.
		s.rollbackProvision(ctx, req.TeamID, vol.ID, uuid.Nil, uuid.Nil)
		return nil, fmt.Errorf("store credentials: %w", err)
	}

	port := int32(0)
	if len(tmpl.Ports) > 0 {
		port = int32(tmpl.Ports[0])
	}

	var backupSchedule *string
	if req.BackupSchedule != "" {
		bs := req.BackupSchedule
		backupSchedule = &bs
	}
	retention := int32(req.RetentionDays)
	storage := "minio"

	created, err := s.queries.CreateDatabase(ctx, db.CreateDatabaseParams{
		TeamID:                req.TeamID,
		ProjectID:             req.ProjectID,
		ClusterID:             req.ClusterID,
		ServerID:              serverID,
		VolumeID:              pgtype.UUID{Bytes: vol.ID, Valid: true},
		TemplateSlug:          req.TemplateSlug,
		Version:               req.Version,
		Name:                  name,
		ContainerName:         containerName,
		Status:                StatusProvisioning,
		Port:                  port,
		SuperuserSecretID:     pgtype.UUID{Bytes: superSecretID, Valid: true},
		AppuserSecretID:       pgtype.UUID{Bytes: appSecretID, Valid: true},
		ResourceCpuMillicores: int32(req.CPUMillicores),
		ResourceMemoryMb:      int32(req.MemoryMB),
		BackupSchedule:        backupSchedule,
		BackupRetentionDays:   &retention,
		BackupStorageType:     &storage,
	})
	if err != nil {
		s.logger.Error("create database row failed", "error", err, "name", name)
		// Roll back volume + secrets so a UNIQUE collision or other insert
		// failure doesn't leak disk and orphaned secret rows.
		s.rollbackProvision(ctx, req.TeamID, vol.ID, superSecretID, appSecretID)
		return nil, fmt.Errorf("create database: %w", err)
	}

	envMap := buildEnv(tmpl, name, superPass, appPass)

	// Hand the deploy + DNS work off to a goroutine so the HTTP request
	// returns immediately with credentials. The UI subscribes to
	// ProvisionChannel(created.ID) for live progress.
	go s.runProvisionAsync(req, project, serverID, &created, &tmpl, &version, &vol, envMap, projectSlug)

	return &ProvisionResult{
		Database:          created,
		SuperuserPassword: superPass,
		AppUserPassword:   appPass,
	}, nil
}

// runProvisionAsync executes the deploy-dispatch + DNS phase outside the
// HTTP request lifecycle and emits progress events.
func (s *Service) runProvisionAsync(
	req ProvisionRequest,
	project db.Project,
	serverID uuid.UUID,
	created *db.Database,
	tmpl *template.Template,
	version *template.Version,
	vol *db.Volume,
	envMap map[string]string,
	projectSlug string,
) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	dbID := created.ID
	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:    "init",
		Level:   "info",
		Message: fmt.Sprintf("starting provision for %s (template=%s version=%s)", created.Name, tmpl.Slug, version.Version),
	})
	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:    "placement",
		Level:   "info",
		Message: fmt.Sprintf("placed on server %s in cluster %s", serverID, req.ClusterID),
	})
	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:    "volume",
		Level:   "info",
		Message: fmt.Sprintf("volume %s ready (%d GB at %s)", vol.ID, vol.SizeGb, vol.HostPath),
	})
	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:    "secrets",
		Level:   "info",
		Message: "credentials sealed in secrets store",
	})
	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:    "deploy",
		Level:   "info",
		Message: fmt.Sprintf("dispatching DeployCommand to agent (image=%s container=%s)", version.Image, created.ContainerName),
	})

	deployID := uuid.NewString()
	resultCh := s.registerDeploy(deployID)
	defer s.unregisterDeploy(deployID)

	if err := s.dispatchDeploy(ctx, deployID, req.TeamID, serverID, created, tmpl, version, vol, envMap); err != nil {
		s.markError(ctx, dbID, err)
		s.publishProvision(ctx, dbID, ProvisionEvent{
			Step:     "deploy",
			Level:    "error",
			Message:  fmt.Sprintf("dispatch deploy failed: %v", err),
			Terminal: true,
			Success:  false,
		})
		return
	}

	// Wait for the agent to drive the deploy through "starting",
	// "health_checking", and finally either "healthy" (Finished+Success) or
	// "failed" (Finished only). Each phase event is mirrored to the SSE
	// console so users see container progress in real time.
	if !s.awaitDeployHealthy(ctx, dbID, deployID, resultCh) {
		// awaitDeployHealthy already set status=error and published a
		// terminal failure event; bail out before DNS/mark-running.
		return
	}

	// CoreDNS only serves the `<clusterSlug>.internal` zone (see
	// internal/dns/corefile.go), so DB hostnames must end with that suffix
	// to be resolvable from agents/apps on the mesh.
	clusterSlug := req.ClusterID.String()[:8]
	if cluster, err := s.queries.GetClusterByIDAnyTeam(ctx, req.ClusterID); err == nil {
		clusterSlug = cluster.Slug
	} else {
		s.logger.Warn("look up cluster slug for dns failed; using id prefix", "error", err, "cluster_id", req.ClusterID)
	}
	dnsRecord := fmt.Sprintf("%s.%s.%s.internal", created.Name, projectSlug, clusterSlug)
	if err := s.queries.UpdateDatabaseDNSRecord(ctx, db.UpdateDatabaseDNSRecordParams{
		ID:        dbID,
		DnsRecord: &dnsRecord,
	}); err != nil {
		s.logger.Warn("set dns_record failed", "error", err, "id", dbID)
		s.publishProvision(ctx, dbID, ProvisionEvent{
			Step:    "dns",
			Level:   "warn",
			Message: fmt.Sprintf("set dns_record failed: %v", err),
		})
	} else {
		s.publishProvision(ctx, dbID, ProvisionEvent{
			Step:    "dns",
			Level:   "info",
			Message: fmt.Sprintf("dns_record set to %s", dnsRecord),
		})
	}

	if _, err := s.queries.UpdateDatabaseStatus(ctx, db.UpdateDatabaseStatusParams{
		ID:     dbID,
		Status: StatusRunning,
	}); err != nil {
		s.logger.Warn("update status to running failed", "error", err, "id", dbID)
		s.publishProvision(ctx, dbID, ProvisionEvent{
			Step:    "status",
			Level:   "warn",
			Message: fmt.Sprintf("update status to running failed: %v", err),
		})
	}

	if s.meshMgr != nil {
		if err := s.meshMgr.PushDNS(ctx, req.ClusterID); err != nil {
			s.logger.Warn("push DNS after provision failed", "error", err, "cluster_id", req.ClusterID, "db_id", dbID)
			s.publishProvision(ctx, dbID, ProvisionEvent{
				Step:    "mesh-dns",
				Level:   "warn",
				Message: fmt.Sprintf("push DNS to cluster failed: %v", err),
			})
		} else {
			s.publishProvision(ctx, dbID, ProvisionEvent{
				Step:    "mesh-dns",
				Level:   "info",
				Message: "CoreDNS hosts pushed to all cluster members",
			})
		}
	}

	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:     "done",
		Level:    "info",
		Message:  fmt.Sprintf("database %s is running", created.Name),
		Terminal: true,
		Success:  true,
	})
}

// registerDeploy reserves a result channel for a database deploy. Must be
// called before dispatching the DeployCommand to avoid a race where the
// DeployOutput arrives before the channel is in the map.
func (s *Service) registerDeploy(deployID string) chan *agentv1.DeployOutput {
	// Buffered: the agent may emit several phase updates ("starting",
	// "health_checking", "healthy") before the consumer drains, and we
	// don't want to block the gRPC handler.
	ch := make(chan *agentv1.DeployOutput, 8)
	s.mu.Lock()
	s.pendingDeploy[deployID] = ch
	s.mu.Unlock()
	return ch
}

func (s *Service) unregisterDeploy(deployID string) {
	s.mu.Lock()
	delete(s.pendingDeploy, deployID)
	s.mu.Unlock()
}

// HandleDeployResult is registered with agent.Server. It claims any
// DeployOutput whose deploy_id we dispatched (returns true), and forwards the
// event to the waiting goroutine. Returns false for app-deployment outputs so
// the standard deployment_targets path runs unchanged.
func (s *Service) HandleDeployResult(ctx context.Context, result *agentv1.DeployOutput) bool {
	if result == nil || result.DeployId == "" {
		return false
	}
	s.mu.Lock()
	ch, ok := s.pendingDeploy[result.DeployId]
	s.mu.Unlock()
	if !ok {
		return false
	}
	// Non-blocking send: if the consumer is slow we drop intermediate phase
	// events rather than stalling the gRPC stream. The terminal event is
	// what matters for status transitions and that's a single message we
	// always make room for via the buffer.
	select {
	case ch <- result:
	default:
		s.logger.Warn("deploy result channel full; dropping phase event",
			"deploy_id", result.DeployId, "phase", result.Phase)
	}
	return true
}

// awaitDeployHealthy reads phase events from the deploy result channel,
// publishes each one to the provision SSE console, and returns true once a
// terminal Success event arrives. Returns false (and emits a terminal failure
// event + flips the row to error) on timeout, ctx cancel, or non-success
// terminal events.
func (s *Service) awaitDeployHealthy(ctx context.Context, dbID uuid.UUID, deployID string, ch <-chan *agentv1.DeployOutput) bool {
	// healthCheckTimeout already covers the agent's own retry loop; pad a
	// small grace window for control-plane round-trip + post-init.
	timeout := healthCheckTimeout + 60*time.Second
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			s.markError(ctx, dbID, fmt.Errorf("await deploy: %w", ctx.Err()))
			s.publishProvision(ctx, dbID, ProvisionEvent{
				Step:     "deploy",
				Level:    "error",
				Message:  fmt.Sprintf("deploy aborted: %v", ctx.Err()),
				Terminal: true,
				Success:  false,
			})
			return false

		case <-timer.C:
			s.markError(ctx, dbID, fmt.Errorf("deploy did not become healthy within %s", timeout))
			s.publishProvision(ctx, dbID, ProvisionEvent{
				Step:     "deploy",
				Level:    "error",
				Message:  fmt.Sprintf("deploy timed out after %s waiting for healthy", timeout),
				Terminal: true,
				Success:  false,
			})
			return false

		case res := <-ch:
			level := "info"
			if res.Error != "" {
				level = "warn"
			}
			msg := fmt.Sprintf("phase=%s", res.Phase)
			if res.ContainerId != "" {
				msg += fmt.Sprintf(" container=%s", res.ContainerId)
			}
			if res.Error != "" {
				msg += " error=" + truncateOneLine(res.Error, 240)
			}
			s.publishProvision(ctx, dbID, ProvisionEvent{
				Step:    "deploy:" + res.Phase,
				Level:   level,
				Message: msg,
			})

			if !res.Finished {
				continue
			}
			if !res.Success {
				cause := fmt.Errorf("deploy failed phase=%s: %s", res.Phase, res.Error)
				s.markError(ctx, dbID, cause)
				s.publishProvision(ctx, dbID, ProvisionEvent{
					Step:     "deploy",
					Level:    "error",
					Message:  fmt.Sprintf("deploy failed: %s", truncateOneLine(res.Error, 240)),
					Terminal: true,
					Success:  false,
				})
				return false
			}
			s.publishProvision(ctx, dbID, ProvisionEvent{
				Step:    "deploy",
				Level:   "info",
				Message: "container healthy and post-init complete",
			})
			return true
		}
	}
}

// truncateOneLine collapses newlines and caps length so an error fits on a
// single SSE event line in the provision console.
func truncateOneLine(s string, max int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

// publishProvision emits a structured event on the database's provisioning
// channel AND appends it to the database row's persistent log so the UI can
// replay history after the live SSE has ended. Best-effort: a publish or
// append failure is logged but never breaks provisioning.
func (s *Service) publishProvision(ctx context.Context, dbID uuid.UUID, evt ProvisionEvent) {
	// Stamp the event with a server-side timestamp so the UI can render a
	// chronological trace without trusting any client clock.
	stamped := struct {
		ProvisionEvent
		At time.Time `json:"at"`
	}{ProvisionEvent: evt, At: time.Now().UTC()}

	payload, err := json.Marshal(stamped)
	if err != nil {
		s.logger.Warn("marshal provision event failed", "error", err)
		return
	}

	// Persist first — Redis pub/sub has no replay, but the DB row is what
	// the detail page reads after the dialog closes. The append query takes
	// a JSONB array, so wrap the single event in `[ ... ]`.
	wrapped := make([]byte, 0, len(payload)+2)
	wrapped = append(wrapped, '[')
	wrapped = append(wrapped, payload...)
	wrapped = append(wrapped, ']')
	if err := s.queries.AppendDatabaseProvisionEvent(ctx, db.AppendDatabaseProvisionEventParams{
		ID:    dbID,
		Event: wrapped,
	}); err != nil {
		s.logger.Warn("append provision event failed", "db_id", dbID, "error", err)
	}

	if s.redis == nil {
		return
	}
	if err := s.redis.Publish(ctx, ProvisionChannel(dbID), string(payload)).Err(); err != nil {
		s.logger.Warn("publish provision event failed", "db_id", dbID, "error", err)
	}
}

// Get returns a single database by ID.
func (s *Service) Get(ctx context.Context, dbID uuid.UUID) (db.Database, error) {
	return s.queries.GetDatabase(ctx, dbID)
}

// List returns every database in the given project.
func (s *Service) List(ctx context.Context, projectID uuid.UUID) ([]db.Database, error) {
	return s.queries.ListDatabasesByProject(ctx, projectID)
}

// Delete stops the container and marks the row deleted. The volume and
// secrets are intentionally retained for safety; an operator can clean them
// up after confirming no data is needed. TODO: opt-in cascade in v2.
func (s *Service) Delete(ctx context.Context, dbID uuid.UUID) error {
	d, err := s.queries.GetDatabase(ctx, dbID)
	if err != nil {
		return fmt.Errorf("get database: %w", err)
	}
	if err := s.sendStop(ctx, &d, 30); err != nil {
		s.logger.Warn("stop container during delete failed; removing row anyway", "error", err, "id", dbID)
	}
	// Detach the volume so its row leaves 'attached' state with a stale
	// container_name. The volume itself is retained (per the retention policy
	// above); marking it unattached lets operators reuse it via RebindVolume
	// or delete it cleanly later.
	if d.VolumeID.Valid {
		volID := uuid.UUID(d.VolumeID.Bytes)
		if _, err := s.volumeSvc.Detach(ctx, d.TeamID, volID); err != nil {
			s.logger.Warn("detach volume during delete failed", "error", err, "id", dbID, "volume_id", volID)
		}
	}
	if err := s.queries.DeleteDatabase(ctx, dbID); err != nil {
		return err
	}
	// Re-push DNS without the deleted DB's record. Failure is non-fatal —
	// the row is already gone and DNS will reconcile on the next mesh regen.
	if s.meshMgr != nil {
		if err := s.meshMgr.PushDNS(ctx, d.ClusterID); err != nil {
			s.logger.Warn("push DNS after delete failed", "error", err, "cluster_id", d.ClusterID, "db_id", dbID)
		}
	}
	return nil
}

// Stop sends a stop command to the agent and updates status.
func (s *Service) Stop(ctx context.Context, dbID uuid.UUID) (db.Database, error) {
	d, err := s.queries.GetDatabase(ctx, dbID)
	if err != nil {
		return db.Database{}, fmt.Errorf("get database: %w", err)
	}
	if err := s.sendStop(ctx, &d, 30); err != nil {
		return db.Database{}, fmt.Errorf("send stop: %w", err)
	}
	return s.queries.UpdateDatabaseStatus(ctx, db.UpdateDatabaseStatusParams{
		ID: dbID, Status: StatusStopped,
	})
}

// Start sends a start command (re-runs the deploy) to the agent. The
// synchronous portion validates inputs and flips the row to 'provisioning';
// the deploy dispatch + health wait runs in a goroutine and updates the row
// to 'running' or 'error' based on the agent's DeployOutput. Callers should
// subscribe to ProvisionChannel(dbID) for live progress just like Provision.
//
// NOTE: this requires the secrets to still be retrievable; we rely on
// BulkResolve which bypasses the reveal-once flag.
func (s *Service) Start(ctx context.Context, dbID uuid.UUID) (db.Database, error) {
	d, err := s.queries.GetDatabase(ctx, dbID)
	if err != nil {
		return db.Database{}, fmt.Errorf("get database: %w", err)
	}
	tmpl, ok := s.templateReg.Get(d.TemplateSlug)
	if !ok {
		return db.Database{}, fmt.Errorf("template no longer exists: %s", d.TemplateSlug)
	}
	version, err := s.templateReg.GetVersion(d.TemplateSlug, d.Version)
	if err != nil {
		return db.Database{}, err
	}

	// Resolve secrets from store. We bypass reveal-once via BulkResolve.
	env := "database:" + d.Name
	resolved, err := s.secretSvc.BulkResolve(ctx, d.TeamID, env, []string{"SUPERUSER_PASSWORD", "APP_PASSWORD"}, nil, "system")
	if err != nil {
		return db.Database{}, fmt.Errorf("resolve credentials: %w", err)
	}
	superPass := resolved["SUPERUSER_PASSWORD"]
	appPass := resolved["APP_PASSWORD"]

	envMap := buildEnv(tmpl, d.Name, superPass, appPass)

	var vol *db.Volume
	if d.VolumeID.Valid {
		v, err := s.queries.GetVolumeAnyTeam(ctx, d.VolumeID.Bytes)
		if err != nil {
			// Hard fail: continuing without the volume would silently start the
			// container with empty storage and overwrite/lose data on next deploy.
			return db.Database{}, fmt.Errorf("get volume: %w", err)
		}
		vol = &v
	}

	// Flip to 'provisioning' so List/Get callers see the in-flight state
	// rather than a stale 'stopped'. The async deploy will move it to
	// 'running' on success or 'error' on failure.
	updated, err := s.queries.UpdateDatabaseStatus(ctx, db.UpdateDatabaseStatusParams{
		ID: dbID, Status: StatusProvisioning,
	})
	if err != nil {
		return db.Database{}, fmt.Errorf("update status: %w", err)
	}

	go s.runStartAsync(d, tmpl, version, vol, envMap)
	return updated, nil
}

// runStartAsync dispatches the deploy and waits for healthy, then flips the
// row to 'running'. Mirrors runProvisionAsync's deploy phase but skips the
// volume/secret/DNS bootstrap steps since they were done at provision time.
func (s *Service) runStartAsync(
	d db.Database,
	tmpl template.Template,
	version template.Version,
	vol *db.Volume,
	envMap map[string]string,
) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	dbID := d.ID
	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:    "init",
		Level:   "info",
		Message: fmt.Sprintf("starting %s (template=%s version=%s)", d.Name, tmpl.Slug, version.Version),
	})

	deployID := uuid.NewString()
	resultCh := s.registerDeploy(deployID)
	defer s.unregisterDeploy(deployID)

	if err := s.dispatchDeploy(ctx, deployID, d.TeamID, d.ServerID, &d, &tmpl, &version, vol, envMap); err != nil {
		s.markError(ctx, dbID, err)
		s.publishProvision(ctx, dbID, ProvisionEvent{
			Step:     "deploy",
			Level:    "error",
			Message:  fmt.Sprintf("dispatch deploy failed: %v", err),
			Terminal: true,
			Success:  false,
		})
		return
	}

	if !s.awaitDeployHealthy(ctx, dbID, deployID, resultCh) {
		// awaitDeployHealthy already set status=error and published a
		// terminal failure event.
		return
	}

	if _, err := s.queries.UpdateDatabaseStatus(ctx, db.UpdateDatabaseStatusParams{
		ID: dbID, Status: StatusRunning,
	}); err != nil {
		s.logger.Warn("update status to running failed", "error", err, "id", dbID)
	}

	s.publishProvision(ctx, dbID, ProvisionEvent{
		Step:     "done",
		Level:    "info",
		Message:  fmt.Sprintf("database %s is running", d.Name),
		Terminal: true,
		Success:  true,
	})
}

// rollbackProvision best-effort cleans up a volume and credential secrets
// created earlier in Provision when a later step (secret write, row insert)
// fails. Each failure is logged but does not propagate — the caller is
// already in an error path and the goal is to avoid leaks, not to mask the
// original error.
func (s *Service) rollbackProvision(ctx context.Context, teamID, volID, superSecretID, appSecretID uuid.UUID) {
	if volID != uuid.Nil {
		if err := s.volumeSvc.Delete(ctx, teamID, volID); err != nil {
			s.logger.Warn("rollback: delete volume failed",
				"team_id", teamID, "volume_id", volID, "error", err)
		}
	}
	var zeroIP netip.Addr
	if superSecretID != uuid.Nil {
		if err := s.secretSvc.Delete(ctx, superSecretID, teamID, nil, "system", zeroIP); err != nil {
			s.logger.Warn("rollback: delete superuser secret failed",
				"team_id", teamID, "secret_id", superSecretID, "error", err)
		}
	}
	if appSecretID != uuid.Nil {
		if err := s.secretSvc.Delete(ctx, appSecretID, teamID, nil, "system", zeroIP); err != nil {
			s.logger.Warn("rollback: delete app secret failed",
				"team_id", teamID, "secret_id", appSecretID, "error", err)
		}
	}
}

// resolvePlacement returns the chosen server. If a server is pinned the
// caller must own it and it must belong to the requested cluster. Otherwise
// we apply a simple "lowest current DB count" scheduler.
//
// TODO: real scheduler will look at capacity (CPU/mem free) in 8.5+.
func (s *Service) resolvePlacement(ctx context.Context, teamID, clusterID uuid.UUID, pinned *uuid.UUID) (uuid.UUID, error) {
	if pinned != nil && *pinned != uuid.Nil {
		member, err := s.queries.GetClusterMemberByServerID(ctx, *pinned)
		if err != nil {
			return uuid.Nil, fmt.Errorf("pinned server not in any cluster: %w", err)
		}
		if member.ClusterID != clusterID {
			return uuid.Nil, errors.New("pinned server is not in the requested cluster")
		}
		// Validate team ownership of the server.
		if _, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: *pinned, TeamID: teamID}); err != nil {
			return uuid.Nil, fmt.Errorf("server not found in team: %w", err)
		}
		return *pinned, nil
	}

	members, err := s.queries.ListClusterMembers(ctx, clusterID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("list cluster members: %w", err)
	}
	if len(members) == 0 {
		return uuid.Nil, errors.New("cluster has no servers")
	}

	counts, err := s.queries.CountDatabasesByServer(ctx, clusterID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("count databases: %w", err)
	}
	loadByServer := make(map[uuid.UUID]int64, len(counts))
	for _, c := range counts {
		loadByServer[c.ServerID] = c.DbCount
	}

	var chosen uuid.UUID
	var minLoad int64 = -1
	for _, m := range members {
		load := loadByServer[m.ServerID]
		if minLoad == -1 || load < minLoad {
			minLoad = load
			chosen = m.ServerID
		}
	}
	if chosen == uuid.Nil {
		return uuid.Nil, errors.New("no eligible server found")
	}
	return chosen, nil
}

// sendStop dispatches a StopContainer command to the database's host agent.
func (s *Service) sendStop(ctx context.Context, d *db.Database, timeoutSec int32) error {
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: d.ServerID, TeamID: d.TeamID})
	if err != nil {
		return fmt.Errorf("get server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		return errors.New("server has no connected agent")
	}
	return s.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_StopContainer{
			StopContainer: &agentv1.StopContainerCommand{
				ContainerName:  d.ContainerName,
				TimeoutSeconds: timeoutSec,
				RemoveTraefik:  false,
			},
		},
	})
}

// dispatchDeploy builds and sends a DeployCommand for a database container.
// deployID is generated by the caller so it can register a result channel
// before dispatch (avoids a race where DeployOutput arrives before we call
// HandleDeployResult).
func (s *Service) dispatchDeploy(
	ctx context.Context,
	deployID string,
	teamID, serverID uuid.UUID,
	d *db.Database,
	tmpl *template.Template,
	version *template.Version,
	vol *db.Volume,
	envMap map[string]string,
) error {
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: serverID, TeamID: teamID})
	if err != nil {
		return fmt.Errorf("get server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		return errors.New("server has no connected agent")
	}

	port := int32(0)
	if len(tmpl.Ports) > 0 {
		port = int32(tmpl.Ports[0])
	}

	mounts := []*agentv1.VolumeMount{}
	if vol != nil && tmpl.VolumeSpec.MountPath != "" {
		mounts = append(mounts, &agentv1.VolumeMount{
			HostPath:      vol.HostPath,
			ContainerPath: tmpl.VolumeSpec.MountPath,
		})
	}

	hc := &agentv1.HealthCheckSpec{}
	if tmpl.HealthCheck.Command != "" {
		hc.Command = tmpl.HealthCheck.Command
		hc.IntervalSeconds = int32(tmpl.HealthCheck.Interval)
		hc.TimeoutSeconds = int32(tmpl.HealthCheck.Timeout)
		hc.Retries = int32(tmpl.HealthCheck.Retries)
	}

	cmd := &agentv1.DeployCommand{
		DeployId:                   deployID,
		TargetId:                   d.ID.String(),
		ImageTag:                   version.Image,
		ContainerName:              d.ContainerName,
		Port:                       port,
		Env:                        envMap,
		HealthCheckIntervalSeconds: int32(tmpl.HealthCheck.Interval),
		HealthCheckTimeoutSeconds:  int32(healthCheckTimeout / time.Second),
		MemoryLimitMb:              d.ResourceMemoryMb,
		CpuLimitMillicores:         d.ResourceCpuMillicores,
		Labels: map[string]string{
			"nixway.managed":     "true",
			"nixway.kind":        "database",
			"nixway.database_id": d.ID.String(),
			"nixway.template":    tmpl.Slug,
			"nixway.version":     version.Version,
			"nixway.project_id":  d.ProjectID.String(),
			"nixway.cluster_id":  d.ClusterID.String(),
		},
		VolumeMounts:     mounts,
		ContainerCommand: tmpl.Command,
		ExecHealthCheck:  hc,
		SkipTraefik:      true,
	}
	return s.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_DeployCommand{DeployCommand: cmd},
	})
}

// markError best-effort flips the database row to error and stores the cause
// on the row so the detail page can show what went wrong after the live SSE
// has ended.
func (s *Service) markError(ctx context.Context, id uuid.UUID, cause error) {
	s.logger.Error("database provisioning failed; marking error", "id", id, "error", cause)
	msg := cause.Error()
	if err := s.queries.SetDatabaseError(ctx, db.SetDatabaseErrorParams{
		ID:           id,
		ErrorMessage: &msg,
	}); err != nil {
		s.logger.Error("failed to mark database error", "id", id, "error", err)
	}
}

// buildEnv interpolates the template's EnvTemplate placeholders with concrete
// credentials and the database name. Placeholders are: {user}, {password},
// {root_user}, {root_password}, {dbname}.
//
// Containers are initialized as the engine's built-in superuser ("postgres",
// "root", "admin", or Redis's implicit "default") using {root_password} so
// backup/restore tooling can authenticate as that user. The application-scoped
// {user}/"app_user" + {password} role is created in a post-init step (see
// apps/agent/deploy.go runDatabasePostInit) once the container is healthy.
//
// NIXWAY_* variables travel with the container so the agent can run engine-
// specific post-init without needing to look up the secret store again.
func buildEnv(tmpl template.Template, dbName, superPass, appPass string) map[string]string {
	rootUser := defaultRootUser(tmpl.Slug)
	out := make(map[string]string, len(tmpl.EnvTemplate)+5)
	for k, v := range tmpl.EnvTemplate {
		s := v
		s = strings.ReplaceAll(s, "{root_user}", rootUser)
		s = strings.ReplaceAll(s, "{root_password}", superPass)
		s = strings.ReplaceAll(s, "{user}", "app_user")
		s = strings.ReplaceAll(s, "{password}", appPass)
		s = strings.ReplaceAll(s, "{dbname}", dbName)
		out[k] = s
	}
	out["NIXWAY_DB_TEMPLATE"] = tmpl.Slug
	out["NIXWAY_DB_NAME"] = dbName
	out["NIXWAY_APP_USER"] = "app_user"
	out["NIXWAY_APP_USER_PASSWORD"] = appPass
	out["NIXWAY_SUPERUSER"] = rootUser
	out["NIXWAY_SUPERUSER_PASSWORD"] = superPass
	return out
}

// defaultRootUser returns the conventional name of the engine's built-in
// superuser, used both by container init env and the agent's post-init step.
func defaultRootUser(slug string) string {
	switch strings.ToLower(slug) {
	case "postgresql", "postgres":
		return "postgres"
	case "mysql", "mariadb":
		return "root"
	case "mongodb", "mongo":
		return "admin"
	case "redis":
		// Redis has no usernames pre-6; for ACL the implicit superuser is
		// "default". Backup/restore code passes this name through unchanged.
		return "default"
	case "rabbitmq":
		return "admin"
	case "minio":
		return "admin"
	default:
		// Single-credential engines (e.g. Meilisearch) — fall back to the
		// app user; nothing references {root_user} for them.
		return "app_user"
	}
}

// randomSuffix returns hex(n bytes) -- 6 chars when n=3.
func randomSuffix(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// RebindVolume detaches the volume currently held by oldDBID and attaches it
// to newDBID. The new database must be in the same project + cluster as the
// old one and must reference a different (or no) volume. If the underlying
// template differs (e.g. attaching a postgres volume to a mysql DB) the call
// fails — that's a hard incompatibility. If the template matches but the
// version differs, the call succeeds and returns a non-empty warning string
// (caller should display it; data may need migration). The new database
// should be in the 'provisioning' or 'stopped' state — rebinding a running
// DB does not currently restart its container; that's an operator action.
func (s *Service) RebindVolume(ctx context.Context, oldDBID, newDBID uuid.UUID) (string, error) {
	if oldDBID == newDBID {
		return "", errors.New("old and new database IDs are identical")
	}
	oldDB, err := s.queries.GetDatabase(ctx, oldDBID)
	if err != nil {
		return "", fmt.Errorf("get old database: %w", err)
	}
	newDB, err := s.queries.GetDatabase(ctx, newDBID)
	if err != nil {
		return "", fmt.Errorf("get new database: %w", err)
	}

	if oldDB.ProjectID != newDB.ProjectID {
		return "", errors.New("databases are in different projects")
	}
	if oldDB.ClusterID != newDB.ClusterID {
		return "", errors.New("databases are in different clusters")
	}
	if oldDB.TemplateSlug != newDB.TemplateSlug {
		return "", fmt.Errorf("template incompatibility: cannot attach %s volume to %s database", oldDB.TemplateSlug, newDB.TemplateSlug)
	}
	if !oldDB.VolumeID.Valid {
		return "", errors.New("source database has no volume to rebind")
	}
	volID := uuid.UUID(oldDB.VolumeID.Bytes)

	// Look up template + new DB's mount path.
	tmpl, ok := s.templateReg.Get(newDB.TemplateSlug)
	if !ok {
		return "", fmt.Errorf("template not found: %s", newDB.TemplateSlug)
	}
	mountPath := tmpl.VolumeSpec.MountPath
	if mountPath == "" {
		return "", fmt.Errorf("template %s has no mount path; cannot rebind volume", newDB.TemplateSlug)
	}

	// Detach from old container (idempotent: if already unattached we skip).
	vol, err := s.volumeSvc.Get(ctx, oldDB.TeamID, volID)
	if err != nil {
		return "", fmt.Errorf("get volume: %w", err)
	}
	if vol.Status == volume.StatusAttached {
		if _, err := s.volumeSvc.Detach(ctx, oldDB.TeamID, volID); err != nil {
			return "", fmt.Errorf("detach volume from old database: %w", err)
		}
	}

	// Attach to new container.
	if _, err := s.volumeSvc.Attach(ctx, volume.AttachRequest{
		TeamID:        newDB.TeamID,
		VolumeID:      volID,
		ContainerName: newDB.ContainerName,
		MountPath:     mountPath,
	}); err != nil {
		return "", fmt.Errorf("attach volume to new database: %w", err)
	}

	// Repoint database rows: new DB now owns the volume, old DB no longer does.
	if err := s.queries.UpdateDatabaseVolume(ctx, db.UpdateDatabaseVolumeParams{
		ID:       newDB.ID,
		VolumeID: pgtype.UUID{Bytes: volID, Valid: true},
	}); err != nil {
		return "", fmt.Errorf("update new database volume: %w", err)
	}
	if err := s.queries.UpdateDatabaseVolume(ctx, db.UpdateDatabaseVolumeParams{
		ID:       oldDB.ID,
		VolumeID: pgtype.UUID{Valid: false},
	}); err != nil {
		s.logger.Warn("clear old database volume_id failed", "error", err, "id", oldDB.ID)
	}

	// Version compat: same slug, different version => warn, don't fail.
	var warning string
	if oldDB.Version != newDB.Version {
		warning = fmt.Sprintf("version change: %s -> %s. data may need migration", oldDB.Version, newDB.Version)
	}
	return warning, nil
}
