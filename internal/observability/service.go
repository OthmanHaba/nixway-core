package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/othmanhaba/nixway-core/internal/db"
)

const (
	StateOK       = "ok"
	StatePending  = "pending"
	StateFiring   = "firing"
	StateResolved = "resolved"
)

type Service struct {
	queries *db.Queries
	logger  *slog.Logger
	client  *http.Client
}

func NewService(queries *db.Queries, logger *slog.Logger) *Service {
	return &Service{
		queries: queries,
		logger:  logger,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *Service) RecordMetric(ctx context.Context, scopeType string, scopeID uuid.UUID, name string, value float64, labels map[string]string, sampledAt time.Time) {
	if s == nil || s.queries == nil || scopeID == uuid.Nil || name == "" {
		return
	}
	if sampledAt.IsZero() {
		sampledAt = time.Now()
	}
	labelsJSON, err := json.Marshal(labels)
	if err != nil {
		labelsJSON = []byte("{}")
	}
	if len(labelsJSON) == 0 || string(labelsJSON) == "null" {
		labelsJSON = []byte("{}")
	}

	if _, err := s.queries.InsertMetricSample(ctx, db.InsertMetricSampleParams{
		ScopeType:  scopeType,
		ScopeID:    scopeID,
		MetricName: name,
		Value:      value,
		Labels:     labelsJSON,
		SampledAt:  sampledAt,
	}); err != nil {
		s.logger.Debug("failed to record metric", "scope_type", scopeType, "scope_id", scopeID, "metric", name, "error", err)
	}
}

func (s *Service) RecordServerHealth(ctx context.Context, serverID uuid.UUID, cpuPercent float64, memoryUsed, memoryTotal int64) {
	s.RecordMetric(ctx, "server", serverID, "server.cpu_percent", cpuPercent, nil, time.Now())
	s.RecordMetric(ctx, "server", serverID, "server.memory_used_bytes", float64(memoryUsed), nil, time.Now())
	s.RecordMetric(ctx, "server", serverID, "server.memory_total_bytes", float64(memoryTotal), nil, time.Now())
	if memoryTotal > 0 {
		s.RecordMetric(ctx, "server", serverID, "server.memory_percent", (float64(memoryUsed)/float64(memoryTotal))*100, nil, time.Now())
	}
}

func (s *Service) StartRetentionLoop(ctx context.Context, rawRetentionDays int) {
	if rawRetentionDays <= 0 {
		rawRetentionDays = 30
	}
	go func() {
		ticker := time.NewTicker(12 * time.Hour)
		defer ticker.Stop()

		for {
			s.deleteOldMetrics(ctx, rawRetentionDays)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *Service) StartAlertEvaluator(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			s.EvaluateAlerts(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *Service) EvaluateAlerts(ctx context.Context) {
	if s == nil || s.queries == nil {
		return
	}

	rules, err := s.queries.ListEnabledAlertRules(ctx)
	if err != nil {
		s.logger.Error("failed to list alert rules", "error", err)
		return
	}

	for _, rule := range rules {
		if err := s.evaluateRule(ctx, rule); err != nil {
			s.logger.Debug("failed to evaluate alert rule", "rule_id", rule.ID, "error", err)
		}
	}
}

func (s *Service) evaluateRule(ctx context.Context, rule db.AlertRule) error {
	latest, err := s.queries.GetLatestMetricSample(ctx, db.GetLatestMetricSampleParams{
		ScopeType:  rule.ScopeType,
		ScopeID:    rule.ScopeID,
		MetricName: rule.MetricName,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}

	duration := time.Duration(rule.DurationSeconds) * time.Second
	if duration <= 0 {
		duration = 5 * time.Minute
	}
	if latest.SampledAt.Before(time.Now().Add(-2 * duration)) {
		return nil
	}

	breached := compare(latest.Value, rule.Threshold, rule.Comparison)
	nextState := nextAlertState(rule.LastState, rule.StateChangedAt, breached, duration, time.Now())

	updated, err := s.queries.UpdateAlertRuleState(ctx, db.UpdateAlertRuleStateParams{
		ID:        rule.ID,
		LastState: nextState,
		LastValue: &latest.Value,
	})
	if err != nil {
		return err
	}
	if nextState == rule.LastState || nextState == StateOK {
		return nil
	}

	message := fmt.Sprintf("%s is %s: %s %.2f %s %.2f", rule.Name, nextState, rule.MetricName, latest.Value, rule.Comparison, rule.Threshold)
	notifiedAt := pgtype.Timestamptz{}
	if nextState == StateFiring || nextState == StateResolved {
		silenced, err := s.isSilenced(ctx, rule)
		if err != nil {
			s.logger.Debug("failed to check alert silence", "rule_id", rule.ID, "error", err)
		}
		if !silenced {
			s.notify(ctx, updated, latest.Value, message)
			notifiedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		}
	}

	_, err = s.queries.CreateAlertEvent(ctx, db.CreateAlertEventParams{
		RuleID:      rule.ID,
		TeamID:      rule.TeamID,
		ScopeType:   rule.ScopeType,
		ScopeID:     rule.ScopeID,
		State:       nextState,
		MetricValue: &latest.Value,
		Threshold:   rule.Threshold,
		Message:     message,
		NotifiedAt:  notifiedAt,
	})
	return err
}

func (s *Service) deleteOldMetrics(ctx context.Context, days int) {
	if err := s.queries.DeleteOldMetricSamples(ctx, time.Now().AddDate(0, 0, -days)); err != nil {
		s.logger.Debug("failed to delete old metric samples", "error", err)
	}
}

func (s *Service) isSilenced(ctx context.Context, rule db.AlertRule) (bool, error) {
	scopeType := rule.ScopeType
	return s.queries.IsAlertSilenced(ctx, db.IsAlertSilencedParams{
		TeamID:    rule.TeamID,
		RuleID:    uuidToPgtype(rule.ID),
		ScopeType: &scopeType,
		ScopeID:   uuidToPgtype(rule.ScopeID),
	})
}

func (s *Service) notify(ctx context.Context, rule db.AlertRule, value float64, message string) {
	if len(rule.NotificationChannels) == 0 {
		return
	}
	channels, err := s.queries.ListNotificationChannelsByIDs(ctx, db.ListNotificationChannelsByIDsParams{
		TeamID:  rule.TeamID,
		Column2: rule.NotificationChannels,
	})
	if err != nil {
		s.logger.Debug("failed to load notification channels", "rule_id", rule.ID, "error", err)
		return
	}

	payload := map[string]any{
		"rule_id":     rule.ID,
		"name":        rule.Name,
		"state":       rule.LastState,
		"severity":    rule.Severity,
		"scope_type":  rule.ScopeType,
		"scope_id":    rule.ScopeID,
		"metric_name": rule.MetricName,
		"value":       value,
		"threshold":   rule.Threshold,
		"message":     message,
		"text":        message,
		"content":     message,
	}
	body, _ := json.Marshal(payload)

	for _, channel := range channels {
		switch channel.Type {
		case "webhook", "slack", "discord":
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, channel.Target, bytes.NewReader(body))
			if err != nil {
				s.logger.Debug("failed to create notification request", "channel_id", channel.ID, "error", err)
				continue
			}
			req.Header.Set("Content-Type", "application/json")
			resp, err := s.client.Do(req)
			if err != nil {
				s.logger.Debug("failed to send notification", "channel_id", channel.ID, "error", err)
				continue
			}
			_ = resp.Body.Close()
		case "email":
			s.logger.Info("alert email notification queued", "channel_id", channel.ID, "target", channel.Target, "message", message)
		}
	}
}

func compare(value, threshold float64, op string) bool {
	switch op {
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

func nextAlertState(current string, changedAt pgtype.Timestamptz, breached bool, duration time.Duration, now time.Time) string {
	switch {
	case breached && current == StatePending:
		if changedAt.Valid && now.Sub(changedAt.Time) >= duration {
			return StateFiring
		}
		return StatePending
	case breached && current == StateFiring:
		return StateFiring
	case breached:
		return StatePending
	case !breached && (current == StatePending || current == StateFiring):
		return StateResolved
	default:
		return StateOK
	}
}

func uuidToPgtype(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}
