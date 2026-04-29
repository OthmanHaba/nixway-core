-- name: CreateDatabaseLink :one
INSERT INTO database_links (database_id, app_id, env_prefix)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetDatabaseLink :one
SELECT * FROM database_links WHERE id = $1;

-- name: ListDatabaseLinksByDatabase :many
SELECT * FROM database_links WHERE database_id = $1 ORDER BY created_at DESC;

-- name: ListDatabaseLinksByApp :many
SELECT * FROM database_links WHERE app_id = $1 ORDER BY created_at DESC;

-- name: DeleteDatabaseLink :exec
DELETE FROM database_links WHERE id = $1;

-- name: DeleteDatabaseLinksByDatabase :exec
DELETE FROM database_links WHERE database_id = $1;
