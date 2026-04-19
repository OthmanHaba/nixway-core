-- +goose Up

CREATE TABLE ssh_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key_encrypted BYTEA NOT NULL,
    key_type TEXT NOT NULL CHECK (key_type IN ('ed25519', 'rsa')),
    fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id TEXT,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    public_ip INET NOT NULL,
    ssh_port INT NOT NULL DEFAULT 22,
    ssh_user TEXT NOT NULL DEFAULT 'root',
    os TEXT,
    os_version TEXT,
    arch TEXT,
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning', 'online', 'degraded', 'offline')),
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE server_ssh_keys (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    ssh_key_id UUID NOT NULL REFERENCES ssh_keys(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, ssh_key_id)
);

CREATE TABLE server_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE (server_id, key)
);

CREATE TABLE server_resources (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    cpu_model TEXT,
    cpu_cores INT,
    memory_total BIGINT,
    memory_available BIGINT,
    kernel_version TEXT,
    docker_version TEXT,
    disks JSONB,
    network_interfaces JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provisioning_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    components TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    logs TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_servers_team ON servers(team_id);
CREATE INDEX idx_servers_agent ON servers(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_servers_status ON servers(team_id, status);
CREATE INDEX idx_ssh_keys_team ON ssh_keys(team_id);
CREATE INDEX idx_server_tags_server ON server_tags(server_id);
CREATE INDEX idx_provisioning_jobs_server ON provisioning_jobs(server_id);

-- +goose Down
DROP TABLE IF EXISTS provisioning_jobs;
DROP TABLE IF EXISTS server_resources;
DROP TABLE IF EXISTS server_tags;
DROP TABLE IF EXISTS server_ssh_keys;
DROP TABLE IF EXISTS servers;
DROP TABLE IF EXISTS ssh_keys;
