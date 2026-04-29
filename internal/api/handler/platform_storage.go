package handler

import (
	"net/http"

	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/config"
	"github.com/othmanhaba/nixway-core/internal/platform"
)

// PlatformStorageHandler exposes admin endpoints for the platform-owned
// object storage backend (MinIO by default).
type PlatformStorageHandler struct {
	minio *platform.MinIOClient
	cfg   config.PlatformStorageConfig
}

func NewPlatformStorageHandler(minioClient *platform.MinIOClient, cfg config.PlatformStorageConfig) *PlatformStorageHandler {
	return &PlatformStorageHandler{minio: minioClient, cfg: cfg}
}

type platformStorageStatus struct {
	Provider   string  `json:"provider"`
	Endpoint   string  `json:"endpoint"`
	Bucket     string  `json:"bucket"`
	Configured bool    `json:"configured"`
	Healthy    bool    `json:"healthy"`
	Error      *string `json:"error"`
}

// Status reports whether the platform storage backend is configured and
// reachable. It is intentionally read-only; provisioning of MinIO is a manual
// operator step in this sub-phase.
func (h *PlatformStorageHandler) Status(w http.ResponseWriter, r *http.Request) {
	resp := platformStorageStatus{
		Provider: h.cfg.Provider,
		Endpoint: h.cfg.Endpoint,
		Bucket:   h.cfg.Bucket,
	}

	if h.minio == nil {
		respond.JSON(w, http.StatusOK, resp)
		return
	}

	resp.Configured = true
	if err := h.minio.Health(r.Context()); err != nil {
		msg := err.Error()
		resp.Error = &msg
		respond.JSON(w, http.StatusOK, resp)
		return
	}

	resp.Healthy = true
	respond.JSON(w, http.StatusOK, resp)
}
