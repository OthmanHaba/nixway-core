-- name: CreateProvisioningJob :one
INSERT INTO provisioning_jobs (server_id, components, status)
VALUES ($1, $2, 'pending') RETURNING *;

-- name: GetProvisioningJob :one
SELECT * FROM provisioning_jobs WHERE id = $1;

-- name: GetLatestProvisioningJob :one
SELECT * FROM provisioning_jobs WHERE server_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: UpdateProvisioningJobStatus :exec
UPDATE provisioning_jobs SET status = $2, started_at = $3, completed_at = $4, error = $5 WHERE id = $1;

-- name: AppendProvisioningLog :exec
UPDATE provisioning_jobs SET logs = logs || $2 WHERE id = $1;
