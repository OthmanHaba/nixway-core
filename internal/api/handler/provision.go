package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/provisioner"
)

type ProvisionHandler struct {
	queries      *db.Queries
	redis        *redis.Client
	audit        *audit.Writer
	logger       *slog.Logger
	provisionSvc *provisioner.Service
}

func NewProvisionHandler(queries *db.Queries, redisClient *redis.Client, auditWriter *audit.Writer, provisionSvc *provisioner.Service, logger *slog.Logger) *ProvisionHandler {
	return &ProvisionHandler{
		queries:      queries,
		redis:        redisClient,
		audit:        auditWriter,
		logger:       logger,
		provisionSvc: provisionSvc,
	}
}

type startProvisionRequest struct {
	Components []string `json:"components"`
}

func (h *ProvisionHandler) Start(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	var req startProvisionRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Components) == 0 {
		respond.Error(w, http.StatusBadRequest, "at least one component is required")
		return
	}

	for _, c := range req.Components {
		if !provisioner.IsValidComponent(c) {
			respond.Error(w, http.StatusBadRequest, fmt.Sprintf("invalid component: %s", c))
			return
		}
	}

	// Verify server belongs to team.
	_, err = h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	job, err := h.queries.CreateProvisioningJob(r.Context(), db.CreateProvisioningJobParams{
		ServerID:   serverID,
		Components: req.Components,
	})
	if err != nil {
		h.logger.Error("failed to create provisioning job", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create provisioning job")
		return
	}

	// Run provisioning over SSH asynchronously.
	go func() {
		h.provisionSvc.RunProvisioning(context.Background(), job.ID, serverID, teamID, req.Components)
	}()

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "provisioning.start",
		ResourceType: "provisioning_job",
		ResourceID:   &job.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, job)
}

func (h *ProvisionHandler) Status(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	job, err := h.queries.GetLatestProvisioningJob(r.Context(), serverID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "no provisioning job found")
		return
	}

	respond.JSON(w, http.StatusOK, job)
}

func (h *ProvisionHandler) StreamLogs(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		respond.Error(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	jobID, err := uuid.Parse(r.PathValue("jobId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid job ID")
		return
	}

	// Verify the job exists
	_, err = h.queries.GetProvisioningJob(r.Context(), jobID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "provisioning job not found")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")

	sub := h.redis.Subscribe(r.Context(), "provision:"+jobID.String())
	defer sub.Close()
	ch := sub.Channel()

	// Send initial connected event
	fmt.Fprintf(w, "data: {\"type\":\"connected\",\"job_id\":\"%s\"}\n\n", jobID.String())
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
			flusher.Flush()
		}
	}
}

func (h *ProvisionHandler) Retry(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid server ID")
		return
	}

	// Verify server belongs to team.
	_, err = h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "server not found")
		return
	}

	// Get latest job to copy components.
	existingJob, err := h.queries.GetLatestProvisioningJob(r.Context(), serverID)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "no previous provisioning job found")
		return
	}

	job, err := h.queries.CreateProvisioningJob(r.Context(), db.CreateProvisioningJobParams{
		ServerID:   serverID,
		Components: existingJob.Components,
	})
	if err != nil {
		h.logger.Error("failed to create retry provisioning job", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create provisioning job")
		return
	}

	// Run provisioning over SSH asynchronously.
	go func() {
		h.provisionSvc.RunProvisioning(context.Background(), job.ID, serverID, teamID, existingJob.Components)
	}()

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "provisioning.retry",
		ResourceType: "provisioning_job",
		ResourceID:   &job.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, job)
}
