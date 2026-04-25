-- +goose Up

CREATE TABLE server_metrics (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    cpu_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
    memory_total BIGINT NOT NULL DEFAULT 0,
    memory_used BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE autoscaling_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metric_name TEXT NOT NULL DEFAULT 'cpu_percent',
    comparison TEXT NOT NULL DEFAULT 'gt' CHECK (comparison IN ('gt', 'gte', 'lt', 'lte')),
    threshold DOUBLE PRECISION NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 120,
    action_type TEXT NOT NULL DEFAULT 'scale_by' CHECK (action_type IN ('scale_by', 'scale_to')),
    action_value INT NOT NULL DEFAULT 1,
    min_replicas INT NOT NULL DEFAULT 1,
    max_replicas INT NOT NULL DEFAULT 10,
    cooldown_up_seconds INT NOT NULL DEFAULT 60,
    cooldown_down_seconds INT NOT NULL DEFAULT 300,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_autoscaling_rules_app ON autoscaling_rules(app_id);
CREATE INDEX idx_autoscaling_rules_enabled ON autoscaling_rules(enabled) WHERE enabled = true;

-- +goose Down

DROP TABLE IF EXISTS autoscaling_rules;
DROP TABLE IF EXISTS server_metrics;
