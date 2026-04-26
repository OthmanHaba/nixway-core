package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	queries            *db.Queries
	logger             *slog.Logger
	client             *http.Client
	victoriaMetricsURL string
	vmagentConfigPath  string
	vmagentURL         string
}

func (s *Service) BuildClusterScrapeConfig(ctx context.Context, clusterID uuid.UUID) (string, error) {
	var b strings.Builder
	writeScrapeConfigHeader(&b)
	if err := s.writeClusterScrapeJob(ctx, &b, clusterID); err != nil {
		return "", err
	}
	return b.String(), nil
}

func (s *Service) BuildTeamScrapeConfig(ctx context.Context, teamID uuid.UUID) (string, error) {
	clusters, err := s.queries.ListClustersByTeam(ctx, teamID)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	writeScrapeConfigHeader(&b)
	if len(clusters) == 0 {
		b.WriteString("  []\n")
		return b.String(), nil
	}
	for _, cluster := range clusters {
		if err := s.writeClusterScrapeJob(ctx, &b, cluster.ID); err != nil {
			return "", err
		}
	}
	return b.String(), nil
}

func (s *Service) SyncClusterScrapeConfig(ctx context.Context, clusterID uuid.UUID) (string, error) {
	cluster, err := s.queries.GetClusterByIDAnyTeam(ctx, clusterID)
	if err != nil {
		return "", err
	}
	return s.SyncTeamScrapeConfig(ctx, cluster.TeamID)
}

func (s *Service) SyncTeamScrapeConfig(ctx context.Context, teamID uuid.UUID) (string, error) {
	config, err := s.BuildTeamScrapeConfig(ctx, teamID)
	if err != nil {
		return "", err
	}
	if err := s.writeVMAgentConfig(config); err != nil {
		return "", err
	}
	if err := s.reloadVMAgent(ctx); err != nil {
		return "", err
	}
	return config, nil
}

func writeScrapeConfigHeader(b *strings.Builder) {
	b.WriteString("global:\n  scrape_interval: 15s\n  scrape_timeout: 10s\n\nscrape_configs:\n")
}

func (s *Service) writeClusterScrapeJob(ctx context.Context, b *strings.Builder, clusterID uuid.UUID) error {
	members, err := s.queries.GetClusterMembersForMesh(ctx, clusterID)
	if err != nil {
		return err
	}
	b.WriteString("  - job_name: nixway-agents-")
	b.WriteString(clusterID.String())
	b.WriteString("\n    metrics_path: /metrics\n    static_configs:\n")
	if len(members) == 0 {
		b.WriteString("      []\n")
		return nil
	}
	for _, member := range members {
		b.WriteString("      - targets: [\"")
		b.WriteString(member.WireguardIp.String())
		b.WriteString(":9100\"]\n")
		b.WriteString("        labels:\n")
		b.WriteString("          cluster_id: \"")
		b.WriteString(clusterID.String())
		b.WriteString("\"\n")
		b.WriteString("          server_id: \"")
		b.WriteString(member.ServerID.String())
		b.WriteString("\"\n")
		b.WriteString("          server_name: \"")
		b.WriteString(escapeYAMLLabel(member.ServerName))
		b.WriteString("\"\n")
	}
	return nil
}

func NewService(queries *db.Queries, logger *slog.Logger, options ...string) *Service {
	vmURL := ""
	if len(options) > 0 {
		vmURL = strings.TrimRight(options[0], "/")
	}
	configPath := "configs/vmagent.yml"
	if len(options) > 1 && strings.TrimSpace(options[1]) != "" {
		configPath = strings.TrimSpace(options[1])
	}
	vmagentURL := "http://localhost:8429"
	if len(options) > 2 && strings.TrimSpace(options[2]) != "" {
		vmagentURL = strings.TrimRight(strings.TrimSpace(options[2]), "/")
	}
	return &Service{
		queries:            queries,
		logger:             logger,
		client:             &http.Client{Timeout: 10 * time.Second},
		victoriaMetricsURL: vmURL,
		vmagentConfigPath:  configPath,
		vmagentURL:         vmagentURL,
	}
}

func (s *Service) writeVMAgentConfig(config string) error {
	path, err := resolveLocalPath(s.vmagentConfigPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(config), 0o644)
}

func (s *Service) reloadVMAgent(ctx context.Context) error {
	if s == nil || s.vmagentURL == "" {
		return fmt.Errorf("vmagent url is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.vmagentURL+"/-/reload", nil)
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("vmagent reload returned %s", resp.Status)
	}
	return nil
}

func resolveLocalPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("vmagent config path is not configured")
	}
	if filepath.IsAbs(path) {
		return path, nil
	}
	if root := os.Getenv("NIXWAY_ROOT"); root != "" {
		return filepath.Join(root, path), nil
	}
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	for _, prefix := range []string{"..", "../.."} {
		candidate := filepath.Join(prefix, path)
		if _, err := os.Stat(filepath.Dir(candidate)); err == nil {
			return candidate, nil
		}
	}
	return path, nil
}

type QueryRangeRequest struct {
	ScopeType  string
	ScopeID    uuid.UUID
	MetricName string
	Since      time.Time
	Limit      int32
}

func (s *Service) QueryRange(ctx context.Context, req QueryRangeRequest) ([]db.MetricSample, error) {
	if s == nil || s.victoriaMetricsURL == "" {
		return nil, fmt.Errorf("victoria metrics url is not configured")
	}
	query, err := promQLForScope(req.ScopeType, req.ScopeID, req.MetricName)
	if err != nil {
		return nil, err
	}

	end := time.Now()
	if req.Since.IsZero() || req.Since.After(end) {
		req.Since = end.Add(-time.Hour)
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 1000
	}
	step := end.Sub(req.Since) / time.Duration(limit)
	if step < 15*time.Second {
		step = 15 * time.Second
	}

	endpoint, err := url.Parse(s.victoriaMetricsURL + "/api/v1/query_range")
	if err != nil {
		return nil, err
	}
	values := endpoint.Query()
	values.Set("query", query)
	values.Set("start", strconv.FormatFloat(float64(req.Since.Unix()), 'f', -1, 64))
	values.Set("end", strconv.FormatFloat(float64(end.Unix()), 'f', -1, 64))
	values.Set("step", strconv.FormatFloat(step.Seconds(), 'f', -1, 64))
	endpoint.RawQuery = values.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("victoria metrics returned %s", resp.Status)
	}

	var parsed vmQueryRangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if parsed.Status != "success" {
		return nil, fmt.Errorf("victoria metrics query failed: %s", parsed.Error)
	}
	if len(parsed.Data.Result) == 0 {
		return nil, nil
	}

	var samples []db.MetricSample
	for _, series := range parsed.Data.Result {
		labelsJSON, _ := json.Marshal(series.Metric)
		for _, pair := range series.Values {
			if len(pair) != 2 {
				continue
			}
			ts, ok := pair[0].(float64)
			if !ok {
				continue
			}
			rawValue, ok := pair[1].(string)
			if !ok {
				continue
			}
			value, err := strconv.ParseFloat(rawValue, 64)
			if err != nil {
				continue
			}
			samples = append(samples, db.MetricSample{
				ScopeType:  req.ScopeType,
				ScopeID:    req.ScopeID,
				MetricName: req.MetricName,
				Value:      value,
				Labels:     labelsJSON,
				SampledAt:  time.Unix(int64(ts), 0),
			})
		}
	}
	return samples, nil
}

type vmQueryRangeResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
	Data   struct {
		Result []struct {
			Metric map[string]string `json:"metric"`
			Values [][]any           `json:"values"`
		} `json:"result"`
	} `json:"data"`
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

func escapeYAMLLabel(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return value
}

func promQLForScope(scopeType string, scopeID uuid.UUID, metricName string) (string, error) {
	metric, ok := prometheusMetricName(metricName)
	if !ok {
		return "", fmt.Errorf("unsupported prometheus metric: %s", metricName)
	}
	id := scopeID.String()
	switch scopeType {
	case "server":
		return fmt.Sprintf(`%s{agent_id="%s"}`, metric, id), nil
	case "container":
		return fmt.Sprintf(`%s{nixway_target_id="%s"}`, metric, id), nil
	case "app":
		return fmt.Sprintf(`avg(%s{nixway_app_id="%s"})`, metric, id), nil
	case "project":
		return fmt.Sprintf(`avg(%s{nixway_project_id="%s"})`, metric, id), nil
	case "cluster":
		if strings.HasPrefix(metricName, "cluster.server_") {
			return fmt.Sprintf(`avg(%s{cluster_id="%s"})`, metric, id), nil
		}
		return fmt.Sprintf(`avg(%s{nixway_cluster_id="%s"})`, metric, id), nil
	default:
		return "", fmt.Errorf("unsupported scope type: %s", scopeType)
	}
}

func prometheusMetricName(metricName string) (string, bool) {
	mapping := map[string]string{
		"server.cpu_percent":                 "nixway_server_cpu_percent",
		"server.memory_percent":              "nixway_server_memory_percent",
		"server.memory_used_bytes":           "nixway_server_memory_used_bytes",
		"server.memory_total_bytes":          "nixway_server_memory_total_bytes",
		"server.memory_free_bytes":           "nixway_server_memory_free_bytes",
		"server.memory_cached_bytes":         "nixway_server_memory_cached_bytes",
		"server.disk_percent":                "nixway_server_disk_percent",
		"server.disk_used_bytes":             "nixway_server_disk_used_bytes",
		"server.disk_total_bytes":            "nixway_server_disk_total_bytes",
		"server.network_rx_bytes":            "nixway_server_network_rx_bytes",
		"server.network_tx_bytes":            "nixway_server_network_tx_bytes",
		"server.load1":                       "nixway_server_load1",
		"server.load5":                       "nixway_server_load5",
		"server.load15":                      "nixway_server_load15",
		"server.file_descriptors":            "nixway_server_file_descriptors",
		"container.cpu_percent":              "nixway_container_cpu_percent",
		"container.memory_percent":           "nixway_container_memory_percent",
		"container.memory_used_bytes":        "nixway_container_memory_used_bytes",
		"container.memory_limit_bytes":       "nixway_container_memory_limit_bytes",
		"container.network_rx_bytes":         "nixway_container_network_rx_bytes",
		"container.network_tx_bytes":         "nixway_container_network_tx_bytes",
		"container.block_read_bytes":         "nixway_container_block_read_bytes",
		"container.block_write_bytes":        "nixway_container_block_write_bytes",
		"container.restart_count":            "nixway_container_restart_count",
		"container.uptime_seconds":           "nixway_container_uptime_seconds",
		"app.container_cpu_percent":          "nixway_container_cpu_percent",
		"app.container_memory_percent":       "nixway_container_memory_percent",
		"app.container_network_rx_bytes":     "nixway_container_network_rx_bytes",
		"app.container_network_tx_bytes":     "nixway_container_network_tx_bytes",
		"project.container_cpu_percent":      "nixway_container_cpu_percent",
		"project.container_memory_percent":   "nixway_container_memory_percent",
		"project.container_network_rx_bytes": "nixway_container_network_rx_bytes",
		"project.container_network_tx_bytes": "nixway_container_network_tx_bytes",
		"cluster.server_cpu_percent":         "nixway_server_cpu_percent",
		"cluster.server_memory_percent":      "nixway_server_memory_percent",
		"cluster.container_cpu_percent":      "nixway_container_cpu_percent",
		"cluster.container_memory_percent":   "nixway_container_memory_percent",
	}
	metric, ok := mapping[metricName]
	return metric, ok
}
