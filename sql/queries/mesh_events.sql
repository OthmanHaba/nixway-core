-- name: CreateMeshEvent :one
INSERT INTO mesh_events (cluster_id, event_type, member_id, details)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListMeshEvents :many
SELECT * FROM mesh_events
WHERE cluster_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListMeshEventsByType :many
SELECT * FROM mesh_events
WHERE cluster_id = $1 AND event_type = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;
