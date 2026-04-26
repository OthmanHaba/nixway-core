-- +goose Up

CREATE TABLE metric_samples (
    id BIGSERIAL PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('server', 'container', 'project', 'cluster', 'app')),
    scope_id UUID NOT NULL,
    metric_name TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    labels JSONB NOT NULL DEFAULT '{}',
    sampled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('email', 'webhook', 'slack', 'discord')),
    target TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('server', 'container', 'project', 'cluster', 'app')),
    scope_id UUID NOT NULL,
    name TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    comparison TEXT NOT NULL DEFAULT 'gt' CHECK (comparison IN ('gt', 'gte', 'lt', 'lte')),
    threshold DOUBLE PRECISION NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 300,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    enabled BOOLEAN NOT NULL DEFAULT true,
    notification_channels UUID[] NOT NULL DEFAULT '{}',
    last_state TEXT NOT NULL DEFAULT 'ok' CHECK (last_state IN ('ok', 'pending', 'firing', 'resolved')),
    last_value DOUBLE PRECISION,
    last_evaluated_at TIMESTAMPTZ,
    state_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL,
    scope_id UUID NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'firing', 'resolved')),
    metric_value DOUBLE PRECISION,
    threshold DOUBLE PRECISION NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_silences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    scope_type TEXT,
    scope_id UUID,
    reason TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_metric_samples_lookup ON metric_samples(scope_type, scope_id, metric_name, sampled_at DESC);
CREATE INDEX idx_metric_samples_retention ON metric_samples(sampled_at);
CREATE INDEX idx_alert_rules_scope ON alert_rules(scope_type, scope_id, created_at DESC);
CREATE INDEX idx_alert_rules_team ON alert_rules(team_id, created_at DESC);
CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled) WHERE enabled = true;
CREATE INDEX idx_alert_events_scope ON alert_events(scope_type, scope_id, created_at DESC);
CREATE INDEX idx_alert_events_rule ON alert_events(rule_id, created_at DESC);
CREATE INDEX idx_alert_silences_active ON alert_silences(team_id, ends_at DESC);

-- +goose Down

DROP TABLE IF EXISTS alert_silences;
DROP TABLE IF EXISTS alert_events;
DROP TABLE IF EXISTS alert_rules;
DROP TABLE IF EXISTS notification_channels;
DROP TABLE IF EXISTS metric_samples;
