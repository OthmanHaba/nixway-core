-- name: CreateDeployment :one
INSERT INTO deployments (app_id, environment_id, build_id, strategy, replicas_desired, env_snapshot)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetDeployment :one
SELECT * FROM deployments WHERE id = $1;

-- name: ListDeploymentsByApp :many
SELECT d.*, b.commit_sha, b.commit_message, b.image_tag
FROM deployments d
JOIN builds b ON b.id = d.build_id
WHERE d.app_id = $1
ORDER BY d.created_at DESC
LIMIT $2 OFFSET $3;

-- name: UpdateDeploymentStatus :exec
UPDATE deployments
SET status = $2, started_at = COALESCE(started_at, $3), error = $4
WHERE id = $1;

-- name: CompleteDeployment :exec
UPDATE deployments
SET status = $2, completed_at = now(), error = $3
WHERE id = $1;

-- name: IncrementReplicasReady :exec
UPDATE deployments SET replicas_ready = replicas_ready + 1 WHERE id = $1;

-- name: AppendDeploymentLogs :exec
UPDATE deployments SET logs = logs || $2 WHERE id = $1;

-- name: SetDeploymentPlatformDomain :exec
UPDATE deployments SET platform_domain = $2 WHERE id = $1;

-- name: GetActiveDeployment :one
SELECT * FROM deployments
WHERE app_id = $1 AND environment_id = $2 AND status = 'healthy'
ORDER BY created_at DESC
LIMIT 1;

-- name: GetLastHealthyDeployment :one
SELECT * FROM deployments
WHERE app_id = $1 AND environment_id = $2 AND status = 'healthy'
ORDER BY created_at DESC
LIMIT 1;

-- name: CreateDeploymentTarget :one
INSERT INTO deployment_targets (deployment_id, server_id)
VALUES ($1, $2)
RETURNING *;

-- name: GetDeploymentTarget :one
SELECT * FROM deployment_targets WHERE id = $1;

-- name: ListDeploymentTargets :many
SELECT dt.*, s.name AS server_name, s.public_ip
FROM deployment_targets dt
JOIN servers s ON s.id = dt.server_id
WHERE dt.deployment_id = $1
ORDER BY dt.started_at ASC;

-- name: UpdateDeploymentTargetStatus :exec
UPDATE deployment_targets
SET status = $2, container_id = COALESCE($3, container_id),
    started_at = COALESCE(started_at, $4),
    healthy_at = $5, stopped_at = $6,
    health_check_attempts = $7, error = $8
WHERE id = $1;

-- name: ListActiveContainersByApp :many
SELECT dt.container_id, dt.server_id, s.name AS server_name, s.agent_id
FROM deployment_targets dt
JOIN deployments d ON d.id = dt.deployment_id
JOIN servers s ON s.id = dt.server_id
WHERE d.app_id = $1 AND d.status = 'healthy' AND dt.status = 'healthy';
