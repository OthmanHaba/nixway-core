package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/othmanhaba/nixway-core/internal/volume"
)

// VolumeHandler exposes the team-scoped volume management API.
type VolumeHandler struct {
	queries *db.Queries
	service *volume.Service
	logger  *slog.Logger
}

func NewVolumeHandler(queries *db.Queries, service *volume.Service, logger *slog.Logger) *VolumeHandler {
	return &VolumeHandler{queries: queries, service: service, logger: logger}
}

type createVolumeRequest struct {
	ClusterID  uuid.UUID `json:"cluster_id"`
	ServerID   uuid.UUID `json:"server_id"`
	Name       string    `json:"name"`
	SizeGB     int32     `json:"size_gb"`
	Filesystem string    `json:"filesystem"`
}

type attachVolumeRequest struct {
	ContainerName string `json:"container_name"`
	MountPath     string `json:"mount_path"`
}

type moveVolumeRequest struct {
	TargetServerID uuid.UUID `json:"target_server_id"`
}

type resizeVolumeRequest struct {
	NewSizeGB int32 `json:"new_size_gb"`
}

func (h *VolumeHandler) requireTeam(w http.ResponseWriter, r *http.Request, role model.Role, scope string) (uuid.UUID, bool) {
	if middleware.GetAuthContext(r) == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return uuid.Nil, false
	}
	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return uuid.Nil, false
	}
	if _, ok := middleware.CheckTeamRole(w, r, h.queries, teamID, role, scope); !ok {
		return uuid.Nil, false
	}
	return teamID, true
}

// Create handles POST /api/v1/teams/{id}/volumes.
func (h *VolumeHandler) Create(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	var req createVolumeRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ClusterID == uuid.Nil || req.ServerID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "cluster_id and server_id are required")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.SizeGB <= 0 {
		respond.Error(w, http.StatusBadRequest, "size_gb must be positive")
		return
	}

	vol, err := h.service.Create(r.Context(), volume.CreateRequest{
		TeamID:     teamID,
		ClusterID:  req.ClusterID,
		ServerID:   req.ServerID,
		Name:       req.Name,
		SizeGB:     req.SizeGB,
		Filesystem: req.Filesystem,
	})
	if err != nil {
		h.logger.Error("failed to create volume", "team_id", teamID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, vol)
}

// List handles GET /api/v1/teams/{id}/volumes (with optional cluster_id, server_id, status filters).
func (h *VolumeHandler) List(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	filter := volume.ListFilter{Status: r.URL.Query().Get("status")}
	if raw := r.URL.Query().Get("cluster_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid cluster_id")
			return
		}
		filter.ClusterID = id
	}
	if raw := r.URL.Query().Get("server_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid server_id")
			return
		}
		filter.ServerID = id
	}
	vols, err := h.service.List(r.Context(), teamID, filter)
	if err != nil {
		h.logger.Error("failed to list volumes", "team_id", teamID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list volumes")
		return
	}
	respond.JSON(w, http.StatusOK, vols)
}

// Get handles GET /api/v1/teams/{id}/volumes/{volumeId}.
func (h *VolumeHandler) Get(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	vol, err := h.service.Get(r.Context(), teamID, volumeID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "volume not found")
		return
	}
	respond.JSON(w, http.StatusOK, vol)
}

// Delete handles DELETE /api/v1/teams/{id}/volumes/{volumeId}?confirm=true.
func (h *VolumeHandler) Delete(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	if r.URL.Query().Get("confirm") != "true" {
		respond.Error(w, http.StatusBadRequest, "confirm=true query parameter is required to delete a volume")
		return
	}
	if err := h.service.Delete(r.Context(), teamID, volumeID); err != nil {
		h.logger.Error("failed to delete volume", "volume_id", volumeID, "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Attach handles POST /api/v1/teams/{id}/volumes/{volumeId}/attach.
func (h *VolumeHandler) Attach(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	var req attachVolumeRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	vol, err := h.service.Attach(r.Context(), volume.AttachRequest{
		TeamID:        teamID,
		VolumeID:      volumeID,
		ContainerName: req.ContainerName,
		MountPath:     req.MountPath,
	})
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, vol)
}

// Detach handles POST /api/v1/teams/{id}/volumes/{volumeId}/detach.
func (h *VolumeHandler) Detach(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	vol, err := h.service.Detach(r.Context(), teamID, volumeID)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, vol)
}

// Move handles POST /api/v1/teams/{id}/volumes/{volumeId}/move.
func (h *VolumeHandler) Move(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	var req moveVolumeRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.TargetServerID == uuid.Nil {
		respond.Error(w, http.StatusBadRequest, "target_server_id is required")
		return
	}
	vol, err := h.service.Move(r.Context(), volume.MoveRequest{
		TeamID:         teamID,
		VolumeID:       volumeID,
		TargetServerID: req.TargetServerID,
	})
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, vol)
}

// Snapshot handles POST /api/v1/teams/{id}/volumes/{volumeId}/snapshot.
func (h *VolumeHandler) Snapshot(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	snap, err := h.service.Snapshot(r.Context(), teamID, volumeID)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, snap)
}

// Resize handles POST /api/v1/teams/{id}/volumes/{volumeId}/resize.
func (h *VolumeHandler) Resize(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	var req resizeVolumeRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.NewSizeGB <= 0 {
		respond.Error(w, http.StatusBadRequest, "new_size_gb must be positive")
		return
	}
	vol, err := h.service.Resize(r.Context(), teamID, volumeID, req.NewSizeGB)
	if err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, vol)
}

// ListSnapshots handles GET /api/v1/teams/{id}/volumes/{volumeId}/snapshots.
func (h *VolumeHandler) ListSnapshots(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	volumeID, err := uuid.Parse(r.PathValue("volumeId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid volume ID")
		return
	}
	snaps, err := h.service.ListSnapshots(r.Context(), teamID, volumeID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, err.Error())
		return
	}
	respond.JSON(w, http.StatusOK, snaps)
}
