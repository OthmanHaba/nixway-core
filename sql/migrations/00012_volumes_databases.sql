-- +goose Up

CREATE TABLE volumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size_gb INT NOT NULL,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    filesystem TEXT NOT NULL DEFAULT 'ext4',
    mount_path TEXT,
    container_name TEXT,
    status TEXT NOT NULL DEFAULT 'unattached',
    host_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(team_id, name)
);

CREATE INDEX idx_volumes_team_id ON volumes(team_id);
CREATE INDEX idx_volumes_cluster_id ON volumes(cluster_id);
CREATE INDEX idx_volumes_server_id ON volumes(server_id);
CREATE INDEX idx_volumes_status ON volumes(status);

CREATE TABLE volume_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    volume_id UUID NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    storage_type TEXT NOT NULL DEFAULT 'local',
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_volume_snapshots_volume_id ON volume_snapshots(volume_id);

CREATE TABLE databases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    volume_id UUID REFERENCES volumes(id) ON DELETE SET NULL,
    template_slug TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    container_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'provisioning',
    port INT NOT NULL,
    dns_record TEXT,
    superuser_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    appuser_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    resource_cpu_millicores INT NOT NULL DEFAULT 500,
    resource_memory_mb INT NOT NULL DEFAULT 512,
    backup_schedule TEXT,
    backup_retention_days INT DEFAULT 7,
    backup_storage_type TEXT DEFAULT 'minio',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, name)
);

CREATE INDEX idx_databases_team_id ON databases(team_id);
CREATE INDEX idx_databases_project_id ON databases(project_id);
CREATE INDEX idx_databases_cluster_id ON databases(cluster_id);
CREATE INDEX idx_databases_server_id ON databases(server_id);
CREATE INDEX idx_databases_status ON databases(status);

CREATE TABLE database_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    env_prefix TEXT NOT NULL DEFAULT 'DATABASE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(database_id, app_id)
);
CREATE INDEX idx_database_links_database_id ON database_links(database_id);
CREATE INDEX idx_database_links_app_id ON database_links(app_id);

CREATE TABLE database_credential_rotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    rotated_by UUID NOT NULL REFERENCES users(id),
    old_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    new_secret_id UUID REFERENCES secrets(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    linked_apps_restarted INT NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_database_credential_rotations_database_id ON database_credential_rotations(database_id);

-- Phase 8.6 — query history + saved queries for the database tooling UI.
-- Every query (read or write) logs a row in database_query_history; users
-- can pin reusable queries per project in database_saved_queries.
CREATE TABLE database_query_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    write_mode BOOLEAN NOT NULL DEFAULT false,
    execution_time_ms INT,
    row_count INT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_database_query_history_user_db ON database_query_history(user_id, database_id, created_at DESC);

CREATE TABLE database_saved_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    database_id UUID REFERENCES databases(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    query_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_database_saved_queries_project ON database_saved_queries(project_id, name);

-- Phase 8.7 — backup history per managed database. A row is created at the
-- moment a backup is initiated and updated by the agent's BackupResult.
-- type: 'manual' (UI/API trigger) | 'scheduled' (cron-driven)
-- status: 'running' | 'completed' | 'failed'
-- backup_tool: 'pg_dump' | 'mysqldump' | 'mongodump' | 'redis-bgsave'
CREATE TABLE database_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'running',
    size_bytes BIGINT,
    storage_type TEXT NOT NULL DEFAULT 'minio',
    storage_path TEXT,
    backup_tool TEXT NOT NULL,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error TEXT
);
CREATE INDEX idx_database_backups_database_id ON database_backups(database_id, started_at DESC);
CREATE INDEX idx_database_backups_status ON database_backups(status);

-- +goose Down

DROP TABLE IF EXISTS database_saved_queries;
DROP TABLE IF EXISTS database_query_history;
DROP TABLE IF EXISTS database_credential_rotations;
DROP TABLE IF EXISTS database_links;
DROP TABLE IF EXISTS database_backups;
DROP TABLE IF EXISTS databases;
DROP TABLE IF EXISTS volume_snapshots;
DROP TABLE IF EXISTS volumes;
