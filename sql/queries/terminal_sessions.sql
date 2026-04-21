-- name: CreateTerminalSession :one
INSERT INTO terminal_sessions (team_id, user_id, app_id, server_id, container_name, replica_index, session_type, client_ip)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: EndTerminalSession :exec
UPDATE terminal_sessions
SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::INT
WHERE id = $1;

-- name: ListTerminalSessionsByTeam :many
SELECT * FROM terminal_sessions
WHERE team_id = $1
ORDER BY started_at DESC
LIMIT $2 OFFSET $3;
