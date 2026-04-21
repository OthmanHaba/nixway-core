-- name: InsertContainerLog :exec
INSERT INTO container_logs (app_id, deployment_id, server_id, container_name, replica_index, line, stream, logged_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: SearchContainerLogs :many
SELECT id, app_id, server_id, container_name, replica_index, line, stream, logged_at
FROM container_logs
WHERE app_id = $1
  AND logged_at >= $2
  AND logged_at <= $3
  AND to_tsvector('english', line) @@ plainto_tsquery('english', $4)
ORDER BY logged_at DESC
LIMIT $5;

-- name: TailContainerLogs :many
SELECT id, app_id, server_id, container_name, replica_index, line, stream, logged_at
FROM container_logs
WHERE app_id = $1
ORDER BY logged_at DESC
LIMIT $2;

-- name: DeleteOldContainerLogs :execresult
DELETE FROM container_logs WHERE ingested_at < $1;
