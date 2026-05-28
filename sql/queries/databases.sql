-- name: CreateDatabase :one
INSERT INTO databases (
    team_id, project_id, cluster_id, server_id, volume_id,
    template_slug, version, name, container_name, status,
    port, superuser_secret_id, appuser_secret_id,
    resource_cpu_millicores, resource_memory_mb,
    backup_schedule, backup_retention_days, backup_storage_type
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
RETURNING *;

-- name: GetDatabase :one
SELECT * FROM databases WHERE id = $1;

-- name: GetDatabaseByName :one
SELECT * FROM databases WHERE project_id = $1 AND name = $2;

-- name: ListDatabasesByProject :many
SELECT * FROM databases WHERE project_id = $1 ORDER BY created_at DESC;

-- name: ListDatabasesByCluster :many
SELECT * FROM databases WHERE cluster_id = $1 ORDER BY created_at DESC;

-- name: CountDatabasesByServer :many
SELECT server_id, COUNT(*) AS db_count
FROM databases
WHERE cluster_id = $1 AND status != 'deleted'
GROUP BY server_id;

-- name: UpdateDatabaseStatus :one
UPDATE databases
SET status = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateDatabaseDNSRecord :exec
UPDATE databases
SET dns_record = $2, updated_at = now()
WHERE id = $1;

-- name: UpdateDatabaseVolume :exec
UPDATE databases
SET volume_id = $2, updated_at = now()
WHERE id = $1;

-- name: AppendDatabaseProvisionEvent :exec
UPDATE databases
SET provision_log = provision_log || $2::jsonb, updated_at = now()
WHERE id = $1;

-- name: SetDatabaseError :exec
UPDATE databases
SET status = 'error', error_message = $2, updated_at = now()
WHERE id = $1;

-- name: ClearDatabaseProvisionLog :exec
UPDATE databases
SET provision_log = '[]'::jsonb, error_message = NULL, updated_at = now()
WHERE id = $1;

-- name: DeleteDatabase :exec
DELETE FROM databases WHERE id = $1;
