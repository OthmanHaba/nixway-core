-- name: CreateAutoscalingRule :one
INSERT INTO autoscaling_rules (
    app_id, name, metric_name, comparison, threshold, duration_seconds,
    action_type, action_value, min_replicas, max_replicas,
    cooldown_up_seconds, cooldown_down_seconds, enabled
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: ListAutoscalingRulesByApp :many
SELECT * FROM autoscaling_rules
WHERE app_id = $1
ORDER BY created_at DESC;

-- name: ListEnabledAutoscalingRulesByApp :many
SELECT * FROM autoscaling_rules
WHERE app_id = $1 AND enabled = true
ORDER BY created_at ASC;

-- name: ListAppsWithEnabledAutoscaling :many
SELECT DISTINCT app_id FROM autoscaling_rules
WHERE enabled = true
ORDER BY app_id;

-- name: GetAutoscalingRule :one
SELECT * FROM autoscaling_rules WHERE id = $1 AND app_id = $2;

-- name: DeleteAutoscalingRule :exec
DELETE FROM autoscaling_rules WHERE id = $1 AND app_id = $2;

-- name: MarkAutoscalingRuleTriggered :exec
UPDATE autoscaling_rules
SET last_triggered_at = now(), updated_at = now()
WHERE id = $1;
