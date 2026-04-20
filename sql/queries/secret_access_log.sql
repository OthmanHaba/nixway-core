-- name: CreateSecretAccessLog :one
INSERT INTO secret_access_log (secret_id, team_id, actor_id, actor_type, action, ip_address)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: ListSecretAccessLogs :many
SELECT * FROM secret_access_log
WHERE secret_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListSecretAccessLogsByTeam :many
SELECT * FROM secret_access_log
WHERE team_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountSecretAccessLogs :one
SELECT count(*) FROM secret_access_log WHERE secret_id = $1;
