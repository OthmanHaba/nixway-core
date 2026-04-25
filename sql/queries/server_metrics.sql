-- name: UpsertServerMetrics :exec
INSERT INTO server_metrics (server_id, cpu_percent, memory_total, memory_used, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (server_id) DO UPDATE SET
    cpu_percent = EXCLUDED.cpu_percent,
    memory_total = EXCLUDED.memory_total,
    memory_used = EXCLUDED.memory_used,
    updated_at = now();

-- name: GetAverageMetricsForApp :one
SELECT
    COALESCE(AVG(sm.cpu_percent), 0)::DOUBLE PRECISION AS cpu_percent,
    COALESCE(AVG(
        CASE WHEN sm.memory_total > 0
            THEN (sm.memory_used::DOUBLE PRECISION / sm.memory_total::DOUBLE PRECISION) * 100
            ELSE 0
        END
    ), 0)::DOUBLE PRECISION AS memory_percent,
    COUNT(sm.server_id)::INT AS sample_count
FROM deployments d
JOIN deployment_targets dt ON dt.deployment_id = d.id
JOIN server_metrics sm ON sm.server_id = dt.server_id
WHERE d.app_id = $1
  AND d.status = 'healthy'
  AND dt.status = 'healthy'
  AND sm.updated_at > now() - interval '2 minutes';

-- name: ListHealthyContainersByApp :many
SELECT
    dt.id AS target_id,
    d.id AS deployment_id,
    dt.container_id,
    dt.server_id,
    s.name AS server_name,
    s.agent_id,
    d.created_at
FROM deployment_targets dt
JOIN deployments d ON d.id = dt.deployment_id
JOIN servers s ON s.id = dt.server_id
WHERE d.app_id = $1
  AND d.status = 'healthy'
  AND dt.status = 'healthy'
  AND dt.container_id IS NOT NULL
ORDER BY d.created_at DESC;
