-- name: EnsureTrafficRoute :one
INSERT INTO traffic_routes (app_id, environment_id, domain)
VALUES ($1, $2, $3)
ON CONFLICT (app_id, environment_id, domain)
DO UPDATE SET updated_at = now()
RETURNING *;

-- name: GetTrafficRoute :one
SELECT * FROM traffic_routes WHERE id = $1;

-- name: GetTrafficRouteByAppEnvironment :one
SELECT * FROM traffic_routes
WHERE app_id = $1 AND environment_id = $2
ORDER BY created_at DESC
LIMIT 1;

-- name: ListTrafficRoutesByApp :many
SELECT * FROM traffic_routes
WHERE app_id = $1
ORDER BY created_at DESC;

-- name: UpsertTrafficBackend :one
INSERT INTO traffic_backends (route_id, deployment_id, label, weight, status)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (route_id, deployment_id)
DO UPDATE SET label = EXCLUDED.label, status = EXCLUDED.status, updated_at = now()
RETURNING *;

-- name: ListTrafficBackendsByRoute :many
SELECT tb.*, d.status AS deployment_status, d.replicas_ready, d.replicas_desired,
       b.commit_sha, b.image_tag
FROM traffic_backends tb
JOIN deployments d ON d.id = tb.deployment_id
JOIN builds b ON b.id = d.build_id
WHERE tb.route_id = $1
ORDER BY tb.created_at DESC;

-- name: CountTrafficBackendsByRoute :one
SELECT COUNT(*)::INT FROM traffic_backends WHERE route_id = $1;

-- name: UpdateTrafficBackendWeight :one
UPDATE traffic_backends
SET weight = $3, updated_at = now()
WHERE id = $1 AND route_id = $2
RETURNING *;

-- name: SetTrafficBackendStatus :one
UPDATE traffic_backends
SET status = $3, updated_at = now()
WHERE id = $1 AND route_id = $2
RETURNING *;

-- name: ListTrafficBackendsForSync :many
SELECT tb.id AS backend_id, tb.deployment_id, tb.label, tb.weight,
       d.status AS deployment_status
FROM traffic_backends tb
JOIN deployments d ON d.id = tb.deployment_id
WHERE tb.route_id = $1
  AND tb.status = 'active'
  AND tb.weight > 0
  AND d.status = 'healthy'
ORDER BY tb.created_at DESC;

-- name: CreateTrafficEvent :one
INSERT INTO traffic_events (route_id, actor_id, actor_type, event_type, message, metadata)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListTrafficEventsByRoute :many
SELECT * FROM traffic_events
WHERE route_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
