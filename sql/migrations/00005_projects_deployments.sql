-- +goose Up

-- Projects: top-level grouping bound to a cluster
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, slug)
);

CREATE INDEX idx_projects_team ON projects(team_id);
CREATE INDEX idx_projects_cluster ON projects(cluster_id);

-- Environments: production auto-created, user can add staging/preview/etc
CREATE TABLE environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    is_production BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, slug)
);

CREATE INDEX idx_environments_project ON environments(project_id);

-- Apps: a deployable unit within a project
CREATE TABLE apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    -- Source type
    source_type TEXT NOT NULL CHECK (source_type IN ('github', 'docker_image')),
    -- GitHub source fields (nullable for docker_image)
    github_installation_id UUID REFERENCES github_installations(id),
    repo_full_name TEXT,
    branch TEXT,
    root_path TEXT NOT NULL DEFAULT '/',
    auto_deploy BOOLEAN NOT NULL DEFAULT true,
    -- Docker image source fields
    docker_image TEXT,
    registry_credential_id UUID REFERENCES registry_credentials(id),
    -- Build config
    builder TEXT NOT NULL DEFAULT 'auto' CHECK (builder IN ('auto', 'dockerfile', 'nixpacks', 'buildpacks', 'railpack')),
    dockerfile_path TEXT NOT NULL DEFAULT 'Dockerfile',
    -- Runtime config
    port INT NOT NULL DEFAULT 8080,
    health_check_path TEXT NOT NULL DEFAULT '/healthz',
    health_check_interval INT NOT NULL DEFAULT 5,
    health_check_timeout INT NOT NULL DEFAULT 60,
    replicas INT NOT NULL DEFAULT 1,
    -- Domain routing
    subdomain TEXT,
    custom_domain TEXT,
    domain_verified BOOLEAN NOT NULL DEFAULT false,
    -- State
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, slug)
);

CREATE INDEX idx_apps_project ON apps(project_id);
CREATE INDEX idx_apps_repo ON apps(repo_full_name) WHERE repo_full_name IS NOT NULL;

-- Builds: one per build attempt
CREATE TABLE builds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    environment_id UUID NOT NULL REFERENCES environments(id),
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('push', 'manual', 'rollback')),
    commit_sha TEXT NOT NULL DEFAULT '',
    commit_message TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '',
    builder TEXT NOT NULL DEFAULT '',
    image_tag TEXT NOT NULL DEFAULT '',
    server_id UUID REFERENCES servers(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'cloning', 'building', 'built', 'failed', 'cancelled')),
    logs TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_builds_app ON builds(app_id);
CREATE INDEX idx_builds_app_created ON builds(app_id, created_at DESC);
CREATE INDEX idx_builds_status ON builds(status) WHERE status IN ('pending', 'cloning', 'building');

-- Deployments: rolling out a build to servers
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    environment_id UUID NOT NULL REFERENCES environments(id),
    build_id UUID NOT NULL REFERENCES builds(id),
    strategy TEXT NOT NULL DEFAULT 'rolling' CHECK (strategy IN ('rolling', 'recreate')),
    replicas_desired INT NOT NULL DEFAULT 1,
    replicas_ready INT NOT NULL DEFAULT 0,
    env_snapshot JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'deploying', 'healthy', 'degraded', 'failed', 'rolled_back')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_app ON deployments(app_id);
CREATE INDEX idx_deployments_app_created ON deployments(app_id, created_at DESC);
CREATE INDEX idx_deployments_status ON deployments(status) WHERE status IN ('pending', 'deploying');

-- Deployment targets: per-server state within a deployment
CREATE TABLE deployment_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id),
    container_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'pulling', 'starting', 'healthy', 'unhealthy', 'stopped', 'failed')),
    health_check_attempts INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    healthy_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    error TEXT,
    UNIQUE (deployment_id, server_id)
);

CREATE INDEX idx_deployment_targets_deployment ON deployment_targets(deployment_id);

-- +goose Down
DROP TABLE IF EXISTS deployment_targets;
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS builds;
DROP TABLE IF EXISTS apps;
DROP TABLE IF EXISTS environments;
DROP TABLE IF EXISTS projects;
