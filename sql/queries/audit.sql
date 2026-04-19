-- name: CreateAuditLog :one
INSERT INTO audit_logs (team_id, actor_id, actor_type, action, resource_type, resource_id, metadata, ip_address)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: ListAuditLogs :many
SELECT al.*, u.name AS actor_name, u.email AS actor_email
FROM audit_logs al
LEFT JOIN users u ON al.actor_id = u.id
WHERE al.team_id = $1
  AND (sqlc.narg('actor_id')::UUID IS NULL OR al.actor_id = sqlc.narg('actor_id'))
  AND (sqlc.narg('action')::TEXT IS NULL OR al.action = sqlc.narg('action'))
  AND (sqlc.narg('resource_type')::TEXT IS NULL OR al.resource_type = sqlc.narg('resource_type'))
  AND (sqlc.narg('resource_id')::UUID IS NULL OR al.resource_id = sqlc.narg('resource_id'))
  AND (sqlc.narg('after')::TIMESTAMPTZ IS NULL OR al.created_at < sqlc.narg('after'))
ORDER BY al.created_at DESC
LIMIT sqlc.arg('page_size');
