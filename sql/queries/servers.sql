-- name: CreateServer :one
INSERT INTO servers (team_id, name, hostname, public_ip, ssh_port, ssh_user, os, os_version, arch, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: GetServerByID :one
SELECT * FROM servers WHERE id = $1 AND team_id = $2;

-- name: GetServerByAgentID :one
SELECT * FROM servers WHERE agent_id = $1;

-- name: ListServersByTeam :many
SELECT * FROM servers WHERE team_id = $1 ORDER BY created_at DESC;

-- name: UpdateServerName :one
UPDATE servers
SET name = $3, updated_at = now()
WHERE id = $1 AND team_id = $2
RETURNING *;

-- name: UpdateServerStatus :exec
UPDATE servers SET status = $2, last_seen_at = $3, updated_at = now() WHERE id = $1;

-- name: UpdateServerAgentID :exec
UPDATE servers SET agent_id = $2, status = 'online', last_seen_at = now(), updated_at = now() WHERE id = $1;

-- name: UpdateServerOS :exec
UPDATE servers SET os = $2, os_version = $3, arch = $4, updated_at = now() WHERE id = $1;

-- name: DeleteServer :exec
DELETE FROM servers WHERE id = $1 AND team_id = $2;

-- name: ListServersNeedingStatusUpdate :many
SELECT id, status, last_seen_at FROM servers
WHERE status IN ('online', 'degraded') AND team_id IS NOT NULL;

-- name: UpdateServerRole :one
UPDATE servers
SET role = $3, updated_at = now()
WHERE id = $1 AND team_id = $2
RETURNING *;

-- name: ListEdgeServersByCluster :many
SELECT * FROM servers
WHERE cluster_id = $1 AND role IN ('edge', 'both')
ORDER BY created_at;
