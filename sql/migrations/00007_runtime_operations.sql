-- +goose Up

-- Historical container logs with full-text search
CREATE TABLE container_logs (
    id BIGSERIAL PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    deployment_id UUID REFERENCES deployments(id) ON DELETE SET NULL,
    server_id UUID NOT NULL REFERENCES servers(id),
    container_name TEXT NOT NULL,
    replica_index INT NOT NULL DEFAULT 0,
    line TEXT NOT NULL,
    stream TEXT NOT NULL DEFAULT 'stdout' CHECK (stream IN ('stdout', 'stderr')),
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_container_logs_app_time ON container_logs(app_id, logged_at DESC);
CREATE INDEX idx_container_logs_search ON container_logs USING gin(to_tsvector('english', line));
CREATE INDEX idx_container_logs_ingested ON container_logs(ingested_at);

-- Resource limits on apps (0 = no limit)
ALTER TABLE apps ADD COLUMN memory_limit_mb INT NOT NULL DEFAULT 0;
ALTER TABLE apps ADD COLUMN cpu_limit_millicores INT NOT NULL DEFAULT 0;

-- Terminal session audit tracking
CREATE TABLE terminal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id),
    user_id UUID NOT NULL REFERENCES users(id),
    app_id UUID REFERENCES apps(id),
    server_id UUID NOT NULL REFERENCES servers(id),
    container_name TEXT,
    replica_index INT,
    session_type TEXT NOT NULL CHECK (session_type IN ('ssh', 'container_exec')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    duration_seconds INT,
    client_ip INET
);

CREATE INDEX idx_terminal_sessions_team ON terminal_sessions(team_id, started_at DESC);

-- +goose Down
DROP TABLE IF EXISTS terminal_sessions;
ALTER TABLE apps DROP COLUMN IF EXISTS cpu_limit_millicores;
ALTER TABLE apps DROP COLUMN IF EXISTS memory_limit_mb;
DROP TABLE IF EXISTS container_logs;
