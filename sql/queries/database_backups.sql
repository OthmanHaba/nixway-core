-- name: CreateBackup :one
INSERT INTO database_backups (database_id, type, status, backup_tool, triggered_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetBackup :one
SELECT * FROM database_backups WHERE id = $1;

-- name: ListBackupsByDatabase :many
SELECT * FROM database_backups WHERE database_id = $1 ORDER BY started_at DESC;

-- name: GetLatestBackupForDatabase :one
SELECT * FROM database_backups
WHERE database_id = $1 AND status = 'completed'
ORDER BY started_at DESC
LIMIT 1;

-- name: ListDatabasesWithBackupSchedule :many
SELECT * FROM databases
WHERE backup_schedule IS NOT NULL AND status = 'running';

-- name: UpdateBackupStarted :exec
UPDATE database_backups
SET status = 'running', started_at = now()
WHERE id = $1;

-- name: UpdateBackupCompleted :exec
UPDATE database_backups
SET status = 'completed',
    size_bytes = $2,
    storage_path = $3,
    completed_at = now()
WHERE id = $1;

-- name: UpdateBackupFailed :exec
UPDATE database_backups
SET status = 'failed',
    error = $2,
    completed_at = now()
WHERE id = $1;

-- name: DeleteBackup :exec
DELETE FROM database_backups WHERE id = $1;

-- name: ListBackupsOlderThan :many
SELECT * FROM database_backups
WHERE database_id = $1
  AND started_at < $2;

-- name: DeleteBackupsOlderThan :exec
DELETE FROM database_backups
WHERE database_id = $1
  AND started_at < $2;
