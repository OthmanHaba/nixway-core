-- +goose Up
ALTER TABLE servers
    ADD COLUMN role TEXT NOT NULL DEFAULT 'worker'
        CHECK (role IN ('worker', 'edge', 'both'));

CREATE INDEX idx_servers_role ON servers(team_id, role);

-- +goose Down
DROP INDEX IF EXISTS idx_servers_role;
ALTER TABLE servers DROP COLUMN IF EXISTS role;
