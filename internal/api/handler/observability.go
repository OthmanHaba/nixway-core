package handler

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/othmanhaba/nixway-core/internal/observability"
)

type ObservabilityHandler struct {
	queries *db.Queries
	service *observability.Service
	logger  *slog.Logger
}

func NewObservabilityHandler(queries *db.Queries, service *observability.Service, logger *slog.Logger) *ObservabilityHandler {
	return &ObservabilityHandler{queries: queries, service: service, logger: logger}
}

type alertRuleRequest struct {
	ScopeType            string      `json:"scope_type"`
	ScopeID              uuid.UUID   `json:"scope_id"`
	Name                 string      `json:"name"`
	MetricName           string      `json:"metric_name"`
	Comparison           string      `json:"comparison"`
	Threshold            float64     `json:"threshold"`
	DurationSeconds      int32       `json:"duration_seconds"`
	Severity             string      `json:"severity"`
	Enabled              *bool       `json:"enabled"`
	NotificationChannels []uuid.UUID `json:"notification_channels"`
}

type notificationChannelRequest struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Target  string `json:"target"`
	Enabled *bool  `json:"enabled"`
}

type silenceRequest struct {
	RuleID          uuid.UUID `json:"rule_id"`
	ScopeType       string    `json:"scope_type"`
	ScopeID         uuid.UUID `json:"scope_id"`
	Reason          string    `json:"reason"`
	DurationSeconds int32     `json:"duration_seconds"`
	EndsAt          time.Time `json:"ends_at"`
}

func (h *ObservabilityHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}

	scopeType := r.URL.Query().Get("scope_type")
	scopeID, err := uuid.Parse(r.URL.Query().Get("scope_id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid scope_id")
		return
	}
	if ok := h.ensureScopeTeam(r, teamID, scopeType, scopeID); !ok {
		respond.Error(w, http.StatusNotFound, "scope not found")
		return
	}

	metric := r.URL.Query().Get("metric")
	if metric == "" {
		latest, err := h.queries.ListLatestMetricSamplesForScope(r.Context(), db.ListLatestMetricSamplesForScopeParams{
			ScopeType: scopeType,
			ScopeID:   scopeID,
		})
		if err != nil {
			h.logger.Error("failed to list latest metrics", "error", err)
			respond.Error(w, http.StatusInternalServerError, "failed to list metrics")
			return
		}
		respond.JSON(w, http.StatusOK, latest)
		return
	}

	since := time.Now().Add(-parseRange(r.URL.Query().Get("range")))
	limit := int32(1000)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 5000 {
			limit = int32(v)
		}
	}

	samples, err := h.service.QueryRange(r.Context(), observability.QueryRangeRequest{
		ScopeType:  scopeType,
		ScopeID:    scopeID,
		MetricName: metric,
		Since:      since,
		Limit:      limit,
	})
	if err == nil && len(samples) > 0 {
		w.Header().Set("X-Metrics-Source", "victoria-metrics")
		respond.JSON(w, http.StatusOK, samples)
		return
	}
	if err != nil {
		h.logger.Debug("victoria metrics query failed, falling back to postgres", "scope_type", scopeType, "scope_id", scopeID, "metric", metric, "error", err)
	}

	samples, err = h.queries.ListMetricSamples(r.Context(), db.ListMetricSamplesParams{
		ScopeType:  scopeType,
		ScopeID:    scopeID,
		MetricName: metric,
		SampledAt:  since,
		Limit:      limit,
	})
	if err != nil {
		h.logger.Error("failed to list metric samples", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to list metric samples")
		return
	}
	respond.JSON(w, http.StatusOK, samples)
}

func (h *ObservabilityHandler) ListAlerts(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	scopeType := r.URL.Query().Get("scope_type")
	scopeIDRaw := r.URL.Query().Get("scope_id")
	if scopeType != "" && scopeIDRaw != "" {
		scopeID, err := uuid.Parse(scopeIDRaw)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid scope_id")
			return
		}
		if ok := h.ensureScopeTeam(r, teamID, scopeType, scopeID); !ok {
			respond.Error(w, http.StatusNotFound, "scope not found")
			return
		}
		rules, err := h.queries.ListAlertRulesByScope(r.Context(), db.ListAlertRulesByScopeParams{
			TeamID:    teamID,
			ScopeType: scopeType,
			ScopeID:   scopeID,
		})
		if err != nil {
			respond.Error(w, http.StatusInternalServerError, "failed to list alert rules")
			return
		}
		respond.JSON(w, http.StatusOK, rules)
		return
	}

	rules, err := h.queries.ListAlertRulesByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list alert rules")
		return
	}
	respond.JSON(w, http.StatusOK, rules)
}

func (h *ObservabilityHandler) CreateAlert(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	var req alertRuleRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := req.validate(); err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if ok := h.ensureScopeTeam(r, teamID, req.ScopeType, req.ScopeID); !ok {
		respond.Error(w, http.StatusNotFound, "scope not found")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	rule, err := h.queries.CreateAlertRule(r.Context(), db.CreateAlertRuleParams{
		TeamID:               teamID,
		ScopeType:            req.ScopeType,
		ScopeID:              req.ScopeID,
		Name:                 req.Name,
		MetricName:           req.MetricName,
		Comparison:           req.Comparison,
		Threshold:            req.Threshold,
		DurationSeconds:      req.DurationSeconds,
		Severity:             req.Severity,
		Enabled:              enabled,
		NotificationChannels: req.NotificationChannels,
	})
	if err != nil {
		h.logger.Error("failed to create alert rule", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create alert rule")
		return
	}
	respond.JSON(w, http.StatusCreated, rule)
}

func (h *ObservabilityHandler) UpdateAlert(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	alertID, err := uuid.Parse(r.PathValue("alertId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	var req alertRuleRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := req.validate(); err != nil {
		respond.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if ok := h.ensureScopeTeam(r, teamID, req.ScopeType, req.ScopeID); !ok {
		respond.Error(w, http.StatusNotFound, "scope not found")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	rule, err := h.queries.UpdateAlertRule(r.Context(), db.UpdateAlertRuleParams{
		ID:                   alertID,
		TeamID:               teamID,
		Name:                 req.Name,
		MetricName:           req.MetricName,
		Comparison:           req.Comparison,
		Threshold:            req.Threshold,
		DurationSeconds:      req.DurationSeconds,
		Severity:             req.Severity,
		Enabled:              enabled,
		NotificationChannels: req.NotificationChannels,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "alert rule not found")
		return
	}
	respond.JSON(w, http.StatusOK, rule)
}

func (h *ObservabilityHandler) DeleteAlert(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	alertID, err := uuid.Parse(r.PathValue("alertId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	if err := h.queries.DeleteAlertRule(r.Context(), db.DeleteAlertRuleParams{ID: alertID, TeamID: teamID}); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to delete alert rule")
		return
	}
	respond.JSON(w, http.StatusNoContent, nil)
}

func (h *ObservabilityHandler) EvaluateAlerts(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite); !ok {
		return
	}
	h.service.EvaluateAlerts(r.Context())
	respond.JSON(w, http.StatusAccepted, map[string]string{"status": "evaluation_started"})
}

func (h *ObservabilityHandler) Events(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	limit := int32(50)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 200 {
			limit = int32(v)
		}
	}

	scopeType := r.URL.Query().Get("scope_type")
	scopeIDRaw := r.URL.Query().Get("scope_id")
	if scopeType != "" && scopeIDRaw != "" {
		scopeID, err := uuid.Parse(scopeIDRaw)
		if err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid scope_id")
			return
		}
		events, err := h.queries.ListAlertEventsByScope(r.Context(), db.ListAlertEventsByScopeParams{
			TeamID:    teamID,
			ScopeType: scopeType,
			ScopeID:   scopeID,
			Limit:     limit,
		})
		if err != nil {
			respond.Error(w, http.StatusInternalServerError, "failed to list alert events")
			return
		}
		respond.JSON(w, http.StatusOK, events)
		return
	}

	events, err := h.queries.ListAlertEventsByTeam(r.Context(), db.ListAlertEventsByTeamParams{TeamID: teamID, Limit: limit})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list alert events")
		return
	}
	respond.JSON(w, http.StatusOK, events)
}

func (h *ObservabilityHandler) ListChannels(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	channels, err := h.queries.ListNotificationChannelsByTeam(r.Context(), teamID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	respond.JSON(w, http.StatusOK, channels)
}

func (h *ObservabilityHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	var req notificationChannelRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	channel, err := h.queries.CreateNotificationChannel(r.Context(), db.CreateNotificationChannelParams{
		TeamID:  teamID,
		Name:    req.Name,
		Type:    req.Type,
		Target:  req.Target,
		Enabled: enabled,
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to create channel")
		return
	}
	respond.JSON(w, http.StatusCreated, channel)
}

func (h *ObservabilityHandler) CreateSilence(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	var req silenceRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	endsAt := req.EndsAt
	if endsAt.IsZero() {
		if req.DurationSeconds <= 0 {
			req.DurationSeconds = 3600
		}
		endsAt = time.Now().Add(time.Duration(req.DurationSeconds) * time.Second)
	}
	silence, err := h.queries.CreateAlertSilence(r.Context(), db.CreateAlertSilenceParams{
		TeamID:    teamID,
		RuleID:    uuidToPG(req.RuleID),
		ScopeType: nullableString(req.ScopeType),
		ScopeID:   uuidToPG(req.ScopeID),
		Reason:    req.Reason,
		EndsAt:    endsAt,
		StartsAt:  time.Now(),
	})
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to create silence")
		return
	}
	respond.JSON(w, http.StatusCreated, silence)
}

func (h *ObservabilityHandler) ClusterScrapeConfig(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleMember, model.ScopeServersRead)
	if !ok {
		return
	}
	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}
	if ok := h.ensureScopeTeam(r, teamID, "cluster", clusterID); !ok {
		respond.Error(w, http.StatusNotFound, "cluster not found")
		return
	}
	config, err := h.service.BuildClusterScrapeConfig(r.Context(), clusterID)
	if err != nil {
		h.logger.Error("failed to build scrape config", "cluster_id", clusterID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to build scrape config")
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(config))
}

func (h *ObservabilityHandler) SyncClusterScrapeConfig(w http.ResponseWriter, r *http.Request) {
	teamID, ok := h.requireTeam(w, r, model.RoleAdmin, model.ScopeServersWrite)
	if !ok {
		return
	}
	clusterID, err := uuid.Parse(r.PathValue("clusterId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid cluster ID")
		return
	}
	if ok := h.ensureScopeTeam(r, teamID, "cluster", clusterID); !ok {
		respond.Error(w, http.StatusNotFound, "cluster not found")
		return
	}
	config, err := h.service.SyncClusterScrapeConfig(r.Context(), clusterID)
	if err != nil {
		h.logger.Error("failed to sync scrape config", "cluster_id", clusterID, "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to sync scrape config")
		return
	}
	respond.JSON(w, http.StatusOK, map[string]string{
		"status": "synced",
		"config": config,
	})
}

func (h *ObservabilityHandler) requireTeam(w http.ResponseWriter, r *http.Request, role model.Role, scope string) (uuid.UUID, bool) {
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

func (h *ObservabilityHandler) ensureScopeTeam(r *http.Request, teamID uuid.UUID, scopeType string, scopeID uuid.UUID) bool {
	switch scopeType {
	case "server":
		_, err := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{ID: scopeID, TeamID: teamID})
		return err == nil
	case "cluster":
		_, err := h.queries.GetClusterByID(r.Context(), db.GetClusterByIDParams{ID: scopeID, TeamID: teamID})
		return err == nil
	case "project":
		project, err := h.queries.GetProject(r.Context(), scopeID)
		return err == nil && project.TeamID == teamID
	case "app":
		app, err := h.queries.GetApp(r.Context(), scopeID)
		if err != nil {
			return false
		}
		project, err := h.queries.GetProject(r.Context(), app.ProjectID)
		return err == nil && project.TeamID == teamID
	case "container":
		return true
	default:
		return false
	}
}

func (req alertRuleRequest) validate() error {
	if req.ScopeType == "" || req.ScopeID == uuid.Nil || req.Name == "" || req.MetricName == "" {
		return errBadRequest("scope_type, scope_id, name, and metric_name are required")
	}
	if req.Comparison == "" {
		return errBadRequest("comparison is required")
	}
	if req.DurationSeconds <= 0 {
		return errBadRequest("duration_seconds must be greater than zero")
	}
	if req.Severity == "" {
		return errBadRequest("severity is required")
	}
	return nil
}

type errBadRequest string

func (e errBadRequest) Error() string { return string(e) }

func parseRange(raw string) time.Duration {
	switch raw {
	case "5m", "":
		return 5 * time.Minute
	case "1h":
		return time.Hour
	case "24h":
		return 24 * time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	case "30d":
		return 30 * 24 * time.Hour
	default:
		if d, err := time.ParseDuration(raw); err == nil {
			return d
		}
		return time.Hour
	}
}

func uuidToPG(id uuid.UUID) pgtype.UUID {
	if id == uuid.Nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: id, Valid: true}
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
