-- +goose Up

CREATE TABLE traffic_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'weighted' CHECK (mode IN ('weighted')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (app_id, environment_id, domain)
);

CREATE TABLE traffic_backends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES traffic_routes(id) ON DELETE CASCADE,
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    weight INT NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draining', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (route_id, deployment_id)
);

CREATE TABLE traffic_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES traffic_routes(id) ON DELETE CASCADE,
    actor_id UUID,
    actor_type TEXT NOT NULL DEFAULT 'system',
    event_type TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_traffic_routes_app ON traffic_routes(app_id, created_at DESC);
CREATE INDEX idx_traffic_backends_route ON traffic_backends(route_id, created_at DESC);
CREATE INDEX idx_traffic_backends_deployment ON traffic_backends(deployment_id);
CREATE INDEX idx_traffic_events_route ON traffic_events(route_id, created_at DESC);

-- +goose Down

DROP TABLE IF EXISTS traffic_events;
DROP TABLE IF EXISTS traffic_backends;
DROP TABLE IF EXISTS traffic_routes;
