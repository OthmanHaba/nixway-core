-- name: CreateApp :one
INSERT INTO apps (
    project_id, name, slug, source_type,
    github_installation_id, repo_full_name, branch, root_path, auto_deploy,
    docker_image, registry_credential_id,
    builder, dockerfile_path,
    port, health_check_path, health_check_interval, health_check_timeout, replicas,
    subdomain
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
RETURNING *;

-- name: GetApp :one
SELECT * FROM apps WHERE id = $1;

-- name: ListAppsByProject :many
SELECT * FROM apps
WHERE project_id = $1
ORDER BY created_at DESC;

-- name: UpdateApp :one
UPDATE apps
SET name = $2, branch = $3, root_path = $4, auto_deploy = $5,
    builder = $6, dockerfile_path = $7,
    port = $8, health_check_path = $9, health_check_interval = $10,
    health_check_timeout = $11, replicas = $12,
    subdomain = $13, custom_domain = $14,
    status = $15, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteApp :exec
DELETE FROM apps WHERE id = $1;

-- name: ListAppsByRepo :many
SELECT a.*, p.team_id
FROM apps a
JOIN projects p ON p.id = a.project_id
WHERE a.repo_full_name = $1 AND a.auto_deploy = true;

-- name: SetAppDomainVerified :exec
UPDATE apps SET domain_verified = $2, updated_at = now() WHERE id = $1;

-- name: SetAppDomains :exec
UPDATE apps SET domains = $2, updated_at = now() WHERE id = $1;

-- name: GetAppDomains :one
SELECT id, domains FROM apps WHERE id = $1;

-- name: UpdateAppResources :one
UPDATE apps
SET memory_limit_mb = $2, cpu_limit_millicores = $3, updated_at = now()
WHERE id = $1
RETURNING *;
