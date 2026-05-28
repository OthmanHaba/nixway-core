-- +goose Up

-- host_port + bind_address let the agent expose a worker replica on the
-- WireGuard mesh, so an edge node can reach it via http://<wg_ip>:<host_port>.
-- bind_address is the worker's own WG IP; host_port comes from the per-server
-- allocator below. Both are NULL when the cluster has no edge node yet, in
-- which case the agent keeps using the legacy Docker DNS path.
ALTER TABLE deployment_targets
    ADD COLUMN host_port    INT,
    ADD COLUMN bind_address TEXT;

-- Tracks host-port reservations per server. Live allocations have
-- released_at IS NULL; the (server_id, port) UNIQUE prevents two
-- live deploys grabbing the same port. The released row is kept for
-- audit / rollback; pickers must filter on released_at IS NULL.
CREATE TABLE server_port_allocations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id            UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    port                 INT  NOT NULL CHECK (port BETWEEN 30000 AND 32767),
    deployment_target_id UUID REFERENCES deployment_targets(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_server_port_allocations_live
    ON server_port_allocations(server_id, port)
    WHERE released_at IS NULL;

CREATE INDEX idx_server_port_allocations_target
    ON server_port_allocations(deployment_target_id);

-- +goose Down
DROP TABLE IF EXISTS server_port_allocations;
ALTER TABLE deployment_targets
    DROP COLUMN IF EXISTS bind_address,
    DROP COLUMN IF EXISTS host_port;
