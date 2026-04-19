-- name: SetServerTag :one
INSERT INTO server_tags (server_id, key, value)
VALUES ($1, $2, $3)
ON CONFLICT (server_id, key) DO UPDATE SET value = EXCLUDED.value
RETURNING *;

-- name: ListServerTags :many
SELECT * FROM server_tags WHERE server_id = $1 ORDER BY key;

-- name: DeleteServerTag :exec
DELETE FROM server_tags WHERE server_id = $1 AND key = $2;
