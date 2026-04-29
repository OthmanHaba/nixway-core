package handler

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/database"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// DatabaseHandler exposes the project-scoped managed-database API.
//
// IMPORTANT: the Provision endpoint is the ONLY place plaintext passwords are
// returned. They are surfaced exactly once; clients must store them or display
// them in a reveal-once UI. Subsequent reads of the database expose only the
// secret IDs, not the passwords themselves.
type DatabaseHandler struct {
	queries *db.Queries
	service *database.Service
	audit   *audit.Writer
	redis   *redis.Client
	logger  *slog.Logger
}

func NewDatabaseHandler(queries *db.Queries, service *database.Service, redisClient *redis.Client, auditWriter *audit.Writer, logger *slog.Logger) *DatabaseHandler {
	return &DatabaseHandler{queries: queries, service: service, audit: auditWriter, redis: redisClient, logger: logger}
}

type provisionDatabaseRequest struct {
	ClusterID      uuid.UUID  `json:"cluster_id"`
	ServerID       *uuid.UUID `json:"server_id"`
	TemplateSlug   string     `json:"template_slug"`
	Version        string     `json:"version"`
	Name           string     `json:"name"`
	SizeGB         int        `json:"size_gb"`
	CPUMillicores  int        `json:"cpu_millicores"`
	MemoryMB       int        `json:"memory_mb"`
	BackupSchedule string     `json:"backup_schedule"`
	RetentionDays  int        `json:"retention_days"`
}

// requireProject validates auth and returns the parsed projectId.
func (h *DatabaseHandler) requireProject(w http.ResponseWriter, r *http.Request) (db.Project, bool) {
	if middleware.GetAuthContext(r) == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return db.Project{}, false
	}
	projectID, err := uuid.Parse(r.PathValue("projectId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid project ID")
		return db.Project{}, false
	}
	project, err := h.queries.GetProject(r.Context(), projectID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "project not found")
		return db.Project{}, false
	}
	return project, true
}

// Provision handles POST /api/v1/projects/{projectId}/databases.
func (h *DatabaseHandler) Provision(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	var req provisionDatabaseRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.TemplateSlug) == "" || strings.TrimSpace(req.Version) == "" {
		respond.Error(w, http.StatusBadRequest, "template_slug and version are required")
		return
	}
	if req.ClusterID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "cluster_id is required")
		return
	}

	result, err := h.service.Provision(r.Context(), database.ProvisionRequest{
		TeamID:         project.TeamID,
		ProjectID:      project.ID,
		ClusterID:      req.ClusterID,
		ServerID:       req.ServerID,
		TemplateSlug:   req.TemplateSlug,
		Version:        req.Version,
		Name:           req.Name,
		SizeGB:         req.SizeGB,
		CPUMillicores:  req.CPUMillicores,
		MemoryMB:       req.MemoryMB,
		BackupSchedule: req.BackupSchedule,
		RetentionDays:  req.RetentionDays,
	})
	if err != nil {
		h.logger.Error("provision database failed", "project_id", project.ID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	// 202 Accepted — the row is in `provisioning` state and the deploy
	// command is being dispatched asynchronously. Clients should subscribe
	// to /provision-stream for live progress.
	respond.JSON(w, http.StatusAccepted, result)
}

// StreamProvisionLogs handles
// GET /api/v1/projects/{projectId}/databases/{databaseId}/provision-stream.
// SSE endpoint that relays ProvisionEvent messages from the Redis pub/sub
// channel for the database's provisioning run.
func (h *DatabaseHandler) StreamProvisionLogs(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	if h.redis == nil {
		respond.Error(w, http.StatusServiceUnavailable, "live provisioning logs require redis; not configured")
		return
	}

	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")

	sub := h.redis.Subscribe(r.Context(), database.ProvisionChannel(d.ID))
	defer sub.Close()
	ch := sub.Channel()

	// Initial connected event so the client knows the stream is live and can
	// distinguish "no logs yet" from "stuck connecting".
	fmt.Fprintf(w, "data: {\"step\":\"connected\",\"level\":\"info\",\"message\":\"stream connected\"}\n\n")
	_ = rc.Flush()

	// If the database is already in a terminal state (running/error) by the
	// time the client connects, emit a synthetic terminal event so the UI
	// doesn't hang waiting for events that already fired.
	switch d.Status {
	case database.StatusRunning:
		fmt.Fprintf(w, "data: {\"step\":\"done\",\"level\":\"info\",\"message\":\"database is already running\",\"terminal\":true,\"success\":true}\n\n")
		_ = rc.Flush()
		return
	case database.StatusError:
		fmt.Fprintf(w, "data: {\"step\":\"done\",\"level\":\"error\",\"message\":\"database is in error state\",\"terminal\":true,\"success\":false}\n\n")
		_ = rc.Flush()
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
			_ = rc.Flush()
		}
	}
}

// List handles GET /api/v1/projects/{projectId}/databases.
func (h *DatabaseHandler) List(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	dbs, err := h.service.List(r.Context(), project.ID)
	if err != nil {
		h.logger.Error("list databases failed", "project_id", project.ID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list databases")
		return
	}
	respond.JSON(w, http.StatusOK, dbs)
}

// GetByID handles GET /api/v1/databases/{databaseId}. Team-scoped (verifies
// the requester belongs to the database's team) so deep-links and detail
// pages don't need a projectId in the URL.
func (h *DatabaseHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	auth := middleware.GetAuthContext(r)
	if auth == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return
	}
	d, err := h.service.Get(r.Context(), dbID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respond.Error(w, http.StatusNotFound, "database not found")
			return
		}
		respond.Error(w, http.StatusInternalServerError, "failed to fetch database")
		return
	}
	if _, err := h.queries.GetMembership(r.Context(), db.GetMembershipParams{
		TeamID: d.TeamID,
		UserID: auth.UserID,
	}); err != nil {
		respond.Error(w, http.StatusNotFound, "database not found")
		return
	}
	respond.JSON(w, http.StatusOK, d)
}

// Get handles GET /api/v1/projects/{projectId}/databases/{databaseId}.
func (h *DatabaseHandler) Get(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return
	}
	d, err := h.service.Get(r.Context(), dbID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respond.Error(w, http.StatusNotFound, "database not found")
			return
		}
		respond.Error(w, http.StatusInternalServerError, "failed to fetch database")
		return
	}
	if d.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "database not found")
		return
	}
	respond.JSON(w, http.StatusOK, d)
}

// Delete handles DELETE /api/v1/projects/{projectId}/databases/{databaseId}.
func (h *DatabaseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return
	}
	d, err := h.service.Get(r.Context(), dbID)
	if err != nil || d.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "database not found")
		return
	}
	if err := h.service.Delete(r.Context(), dbID); err != nil {
		h.logger.Error("delete database failed", "id", dbID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Stop handles POST /api/v1/projects/{projectId}/databases/{databaseId}/stop.
func (h *DatabaseHandler) Stop(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return
	}
	d, err := h.service.Get(r.Context(), dbID)
	if err != nil || d.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "database not found")
		return
	}
	updated, err := h.service.Stop(r.Context(), dbID)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, updated)
}

// rebindVolumeRequest is the body for the RebindVolume endpoint.
type rebindVolumeRequest struct {
	OldDatabaseID uuid.UUID `json:"old_database_id"`
}

// rebindVolumeResponse is returned to the client after a successful rebind.
// `Warning` is non-empty when the bind succeeded but the operator should
// review (e.g. template version changed and data may need migration).
type rebindVolumeResponse struct {
	Warning string `json:"warning"`
}

// RebindVolume handles POST /api/v1/projects/{projectId}/databases/{databaseId}/rebind-volume.
// Body: { "old_database_id": "<uuid>" }. Both DBs must belong to the same
// project as {projectId}. The volume is detached from old_database_id and
// attached to {databaseId}.
func (h *DatabaseHandler) RebindVolume(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	newDBID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return
	}
	var req rebindVolumeRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.OldDatabaseID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "old_database_id is required")
		return
	}

	// Verify both DBs belong to this project (defence in depth — RebindVolume
	// also rejects cross-project rebinds, but we want a 404, not a 422, when
	// the caller has no business touching the source DB).
	newDB, err := h.service.Get(r.Context(), newDBID)
	if err != nil || newDB.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "database not found")
		return
	}
	oldDB, err := h.service.Get(r.Context(), req.OldDatabaseID)
	if err != nil || oldDB.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "source database not found")
		return
	}

	warning, err := h.service.RebindVolume(r.Context(), req.OldDatabaseID, newDBID)
	if err != nil {
		h.logger.Error("rebind volume failed", "old_id", req.OldDatabaseID, "new_id", newDBID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, rebindVolumeResponse{Warning: warning})
}

// requireDatabaseInProject is a defence-in-depth check: confirms the
// {databaseId} path param both exists and belongs to {projectId}.
func (h *DatabaseHandler) requireDatabaseInProject(w http.ResponseWriter, r *http.Request, project db.Project) (db.Database, bool) {
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return db.Database{}, false
	}
	d, err := h.service.Get(r.Context(), dbID)
	if err != nil || d.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "database not found")
		return db.Database{}, false
	}
	return d, true
}

type linkDatabaseRequest struct {
	AppID     uuid.UUID `json:"app_id"`
	EnvPrefix string    `json:"env_prefix"`
}

// LinkDatabase handles POST /api/v1/projects/{projectId}/databases/{databaseId}/links.
func (h *DatabaseHandler) LinkDatabase(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	var req linkDatabaseRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.AppID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "app_id is required")
		return
	}
	link, err := h.service.LinkDatabase(r.Context(), d.ID, req.AppID, req.EnvPrefix)
	if err != nil {
		h.logger.Error("link database failed", "database_id", d.ID, "app_id", req.AppID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, link)
}

// ListLinks handles GET /api/v1/projects/{projectId}/databases/{databaseId}/links.
func (h *DatabaseHandler) ListLinks(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	links, err := h.service.ListLinks(r.Context(), d.ID)
	if err != nil {
		h.logger.Error("list links failed", "database_id", d.ID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list links")
		return
	}
	respond.JSON(w, http.StatusOK, links)
}

// UnlinkDatabase handles DELETE /api/v1/projects/{projectId}/databases/{databaseId}/links/{linkId}.
func (h *DatabaseHandler) UnlinkDatabase(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	linkID, err := uuid.Parse(r.PathValue("linkId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid link ID")
		return
	}
	link, err := h.queries.GetDatabaseLink(r.Context(), linkID)
	if err != nil || link.DatabaseID != d.ID {
		respond.Error(w, http.StatusNotFound, "link not found")
		return
	}
	if err := h.service.UnlinkDatabase(r.Context(), linkID); err != nil {
		h.logger.Error("unlink database failed", "link_id", linkID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, map[string]string{"status": "unlinked"})
}

type rotateCredentialsResponse struct {
	NewPassword string    `json:"new_password"`
	RotationID  uuid.UUID `json:"rotation_id"`
}

// RotateCredentials handles POST /api/v1/projects/{projectId}/databases/{databaseId}/rotate.
// Returns the new app-user password plaintext exactly once.
func (h *DatabaseHandler) RotateCredentials(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	newPassword, rotationID, err := h.service.RotateAppUserCredential(r.Context(), d.ID, authCtx.UserID)
	if err != nil {
		h.logger.Error("rotate credentials failed", "database_id", d.ID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	// Best-effort audit log. We count linked apps from the rotation row's
	// outcome via ListRotations since the service already persisted the
	// LinkedAppsRestarted counter.
	if h.audit != nil {
		linkedCount := 0
		if rec, err := h.queries.GetDatabaseCredentialRotation(r.Context(), rotationID); err == nil {
			linkedCount = int(rec.LinkedAppsRestarted)
		}
		if err := h.audit.WriteDatabaseCredentialRotated(r.Context(), project.TeamID, authCtx.UserID, d.ID, linkedCount); err != nil {
			h.logger.Warn("audit log for credential rotation failed", "database_id", d.ID, "error", err)
		}
	}

	respond.JSON(w, http.StatusOK, rotateCredentialsResponse{
		NewPassword: newPassword,
		RotationID:  rotationID,
	})
}

// ListRotations handles GET /api/v1/projects/{projectId}/databases/{databaseId}/rotations.
func (h *DatabaseHandler) ListRotations(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	rotations, err := h.service.ListRotations(r.Context(), d.ID)
	if err != nil {
		h.logger.Error("list rotations failed", "database_id", d.ID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list rotations")
		return
	}
	respond.JSON(w, http.StatusOK, rotations)
}

// Start handles POST /api/v1/projects/{projectId}/databases/{databaseId}/start.
func (h *DatabaseHandler) Start(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	dbID, err := uuid.Parse(r.PathValue("databaseId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid database ID")
		return
	}
	d, err := h.service.Get(r.Context(), dbID)
	if err != nil || d.ProjectID != project.ID {
		respond.Error(w, http.StatusNotFound, "database not found")
		return
	}
	updated, err := h.service.Start(r.Context(), dbID)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, updated)
}

// CreateBackup handles POST /api/v1/projects/{projectId}/databases/{databaseId}/backups.
// Triggers a manual backup. Returns the backup record once initiated; the
// dump runs asynchronously and the row is finalised by the agent's result.
func (h *DatabaseHandler) CreateBackup(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}
	rec, err := h.service.CreateBackup(r.Context(), d.ID, authCtx.UserID)
	if err != nil {
		h.logger.Error("create backup failed", "database_id", d.ID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if h.audit != nil {
		if err := h.audit.WriteDatabaseBackupCreated(r.Context(), project.TeamID, authCtx.UserID, d.ID, rec.ID); err != nil {
			h.logger.Warn("audit log for backup created failed", "database_id", d.ID, "error", err)
		}
	}
	respond.JSON(w, http.StatusAccepted, rec)
}

// ListBackups handles GET /api/v1/projects/{projectId}/databases/{databaseId}/backups.
func (h *DatabaseHandler) ListBackups(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	backups, err := h.service.ListBackups(r.Context(), d.ID)
	if err != nil {
		h.logger.Error("list backups failed", "database_id", d.ID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list backups")
		return
	}
	respond.JSON(w, http.StatusOK, backups)
}

// GetBackup handles GET /api/v1/projects/{projectId}/databases/{databaseId}/backups/{backupId}.
func (h *DatabaseHandler) GetBackup(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	backupID, err := uuid.Parse(r.PathValue("backupId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid backup ID")
		return
	}
	rec, err := h.service.GetBackup(r.Context(), backupID)
	if err != nil || rec.DatabaseID != d.ID {
		respond.Error(w, http.StatusNotFound, "backup not found")
		return
	}
	respond.JSON(w, http.StatusOK, rec)
}

// DeleteBackup handles DELETE /api/v1/projects/{projectId}/databases/{databaseId}/backups/{backupId}.
func (h *DatabaseHandler) DeleteBackup(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}
	backupID, err := uuid.Parse(r.PathValue("backupId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid backup ID")
		return
	}
	rec, err := h.service.GetBackup(r.Context(), backupID)
	if err != nil || rec.DatabaseID != d.ID {
		respond.Error(w, http.StatusNotFound, "backup not found")
		return
	}
	if err := h.service.DeleteBackup(r.Context(), backupID); err != nil {
		h.logger.Error("delete backup failed", "backup_id", backupID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if h.audit != nil {
		if err := h.audit.WriteDatabaseBackupDeleted(r.Context(), project.TeamID, authCtx.UserID, d.ID, backupID); err != nil {
			h.logger.Warn("audit log for backup deleted failed", "database_id", d.ID, "error", err)
		}
	}
	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type restoreRequest struct {
	BackupID uuid.UUID `json:"backup_id"`
	Target   string    `json:"target"`
	NewName  string    `json:"new_name"`
}

// Restore handles POST /api/v1/projects/{projectId}/databases/{databaseId}/restore.
// Body: { "backup_id": "...", "target": "in_place" | "new", "new_name": "..." }.
// The {databaseId} path param is the SOURCE database (the one the backup
// belongs to). The response's database is the target — same as source for
// in-place, freshly provisioned for "new".
func (h *DatabaseHandler) Restore(w http.ResponseWriter, r *http.Request) {
	project, ok := h.requireProject(w, r)
	if !ok {
		return
	}
	d, ok := h.requireDatabaseInProject(w, r, project)
	if !ok {
		return
	}
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var req restoreRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.BackupID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "backup_id is required")
		return
	}
	target := strings.TrimSpace(req.Target)
	if target == "" {
		target = "in_place"
	}
	if target != "in_place" && target != "new" {
		respond.Error(w, http.StatusBadRequest, "target must be 'in_place' or 'new'")
		return
	}

	// Defence in depth: confirm the backup belongs to this database.
	rec, err := h.service.GetBackup(r.Context(), req.BackupID)
	if err != nil || rec.DatabaseID != d.ID {
		respond.Error(w, http.StatusNotFound, "backup not found")
		return
	}

	result, err := h.service.RestoreFromBackup(r.Context(), req.BackupID, authCtx.UserID, target, req.NewName)
	if err != nil {
		h.logger.Error("restore failed", "backup_id", req.BackupID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if h.audit != nil {
		if err := h.audit.WriteDatabaseRestored(r.Context(), project.TeamID, authCtx.UserID, d.ID, req.BackupID, result.Database.ID, target); err != nil {
			h.logger.Warn("audit log for restore failed", "database_id", d.ID, "error", err)
		}
	}
	respond.JSON(w, http.StatusOK, result)
}
