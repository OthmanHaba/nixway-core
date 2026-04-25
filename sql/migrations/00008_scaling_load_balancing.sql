-- +goose Up

ALTER TABLE apps
    ADD COLUMN placement_strategy TEXT NOT NULL DEFAULT 'spread'
        CHECK (placement_strategy IN ('spread', 'binpack', 'pinned')),
    ADD COLUMN placement_constraints JSONB NOT NULL DEFAULT '{"must_have": {}, "must_not_have": {}}',
    ADD COLUMN pinned_server_ids UUID[] NOT NULL DEFAULT '{}';

CREATE TABLE scaling_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
    deployment_id UUID REFERENCES deployments(id) ON DELETE SET NULL,
    actor_id UUID,
    actor_type TEXT NOT NULL DEFAULT 'system',
    event_type TEXT NOT NULL,
    from_replicas INT NOT NULL DEFAULT 0,
    to_replicas INT NOT NULL DEFAULT 0,
    placement_strategy TEXT NOT NULL DEFAULT 'spread',
    metric_name TEXT,
    metric_value DOUBLE PRECISION,
    rule_name TEXT,
    message TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scaling_events_app_created ON scaling_events(app_id, created_at DESC);
CREATE INDEX idx_scaling_events_deployment ON scaling_events(deployment_id) WHERE deployment_id IS NOT NULL;

-- +goose Down

DROP TABLE IF EXISTS scaling_events;

ALTER TABLE apps
    DROP COLUMN IF EXISTS pinned_server_ids,
    DROP COLUMN IF EXISTS placement_constraints,
    DROP COLUMN IF EXISTS placement_strategy;
