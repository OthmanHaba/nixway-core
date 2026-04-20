-- +goose Up

CREATE TABLE clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    cidr CIDR NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'degraded', 'error')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, slug),
    UNIQUE (cidr)
);

CREATE TABLE cluster_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    wireguard_ip INET NOT NULL,
    wireguard_public_key TEXT NOT NULL,
    wireguard_endpoint TEXT NOT NULL,
    listen_port INT NOT NULL DEFAULT 51820,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (server_id),
    UNIQUE (cluster_id, wireguard_ip)
);

CREATE TABLE wireguard_peers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES cluster_members(id) ON DELETE CASCADE,
    peer_member_id UUID NOT NULL REFERENCES cluster_members(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'degraded', 'failed')),
    last_handshake_at TIMESTAMPTZ,
    last_check_at TIMESTAMPTZ,
    rtt_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, peer_member_id)
);

CREATE TABLE mesh_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    member_id UUID REFERENCES cluster_members(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add cluster_id to servers for convenience lookups
ALTER TABLE servers ADD COLUMN cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_clusters_team ON clusters(team_id);
CREATE INDEX idx_cluster_members_cluster ON cluster_members(cluster_id);
CREATE INDEX idx_cluster_members_server ON cluster_members(server_id);
CREATE INDEX idx_wireguard_peers_member ON wireguard_peers(member_id);
CREATE INDEX idx_wireguard_peers_peer ON wireguard_peers(peer_member_id);
CREATE INDEX idx_wireguard_peers_status ON wireguard_peers(status);
CREATE INDEX idx_mesh_events_cluster ON mesh_events(cluster_id);
CREATE INDEX idx_mesh_events_created ON mesh_events(cluster_id, created_at DESC);
CREATE INDEX idx_servers_cluster ON servers(cluster_id) WHERE cluster_id IS NOT NULL;

-- +goose Down
ALTER TABLE servers DROP COLUMN IF EXISTS cluster_id;
DROP TABLE IF EXISTS mesh_events;
DROP TABLE IF EXISTS wireguard_peers;
DROP TABLE IF EXISTS cluster_members;
DROP TABLE IF EXISTS clusters;
