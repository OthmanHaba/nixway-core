-- +goose Up

-- App-level environment variables: configurable .env scoped to a single app and
-- environment. Values are encrypted at rest with the same AES-secretbox scheme as
-- secrets. At deploy time these are merged on top of team secrets (app vars win)
-- and below database-link/platform-reserved vars.
CREATE TABLE app_env_vars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (app_id, environment_id, key)
);

CREATE INDEX idx_app_env_vars_app_env ON app_env_vars(app_id, environment_id);

-- +goose Down
DROP TABLE IF EXISTS app_env_vars;
