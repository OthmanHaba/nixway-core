-- +goose Up

-- GitHub App installations (one per team)
CREATE TABLE github_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    app_id BIGINT NOT NULL,
    app_name TEXT NOT NULL,
    app_slug TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret BYTEA NOT NULL,
    private_key BYTEA NOT NULL,
    webhook_secret BYTEA NOT NULL,
    html_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id)
);

-- GitHub installations (app installed on org/account)
CREATE TABLE github_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_app_id UUID NOT NULL REFERENCES github_apps(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL,
    account_login TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('Organization', 'User')),
    target_type TEXT NOT NULL DEFAULT 'selected' CHECK (target_type IN ('all', 'selected')),
    suspended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (github_app_id, installation_id)
);

-- Webhook events log
CREATE TABLE github_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_app_id UUID NOT NULL REFERENCES github_apps(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    action TEXT,
    delivery_id TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Container registry credentials
CREATE TABLE registry_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    registry_type TEXT NOT NULL CHECK (registry_type IN ('dockerhub', 'ghcr', 'ecr', 'generic')),
    registry_url TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    password BYTEA NOT NULL,
    region TEXT,
    aws_access_key_id TEXT,
    aws_secret_access_key BYTEA,
    validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, name)
);

-- Encrypted secrets
CREATE TABLE secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    environment TEXT NOT NULL DEFAULT 'production',
    key TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    version INT NOT NULL DEFAULT 1,
    revealed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, environment, key)
);

-- Secret audit log
CREATE TABLE secret_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    actor_id UUID,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'deploy')),
    action TEXT NOT NULL CHECK (action IN ('create', 'read', 'resolve', 'update', 'delete')),
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_github_apps_team ON github_apps(team_id);
CREATE INDEX idx_github_installations_app ON github_installations(github_app_id);
CREATE INDEX idx_github_webhook_events_app ON github_webhook_events(github_app_id);
CREATE INDEX idx_github_webhook_events_created ON github_webhook_events(created_at);
CREATE INDEX idx_github_webhook_events_type ON github_webhook_events(event_type);
CREATE INDEX idx_registry_credentials_team ON registry_credentials(team_id);
CREATE INDEX idx_secrets_team_env ON secrets(team_id, environment);
CREATE INDEX idx_secret_access_log_secret ON secret_access_log(secret_id);
CREATE INDEX idx_secret_access_log_team ON secret_access_log(team_id);
CREATE INDEX idx_secret_access_log_created ON secret_access_log(created_at);

-- +goose Down
DROP TABLE IF EXISTS secret_access_log;
DROP TABLE IF EXISTS secrets;
DROP TABLE IF EXISTS registry_credentials;
DROP TABLE IF EXISTS github_webhook_events;
DROP TABLE IF EXISTS github_installations;
DROP TABLE IF EXISTS github_apps;
