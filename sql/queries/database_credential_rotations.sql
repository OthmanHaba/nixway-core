-- name: CreateDatabaseCredentialRotation :one
INSERT INTO database_credential_rotations (database_id, rotated_by, old_secret_id, status)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetDatabaseCredentialRotation :one
SELECT * FROM database_credential_rotations WHERE id = $1;

-- name: ListDatabaseCredentialRotationsByDatabase :many
SELECT * FROM database_credential_rotations WHERE database_id = $1 ORDER BY created_at DESC;

-- name: UpdateDatabaseCredentialRotationStatus :exec
UPDATE database_credential_rotations
SET status = $2, error = $3
WHERE id = $1;

-- name: UpdateDatabaseCredentialRotationCompleted :exec
UPDATE database_credential_rotations
SET status = $2,
    new_secret_id = $3,
    linked_apps_restarted = $4,
    completed_at = now(),
    error = $5
WHERE id = $1;
