-- name: InsertMetricSample :one
INSERT INTO metric_samples (scope_type, scope_id, metric_name, value, labels, sampled_at)
VALUES ($1, $2, $3, $4, $5, COALESCE(sqlc.narg(sampled_at), now()))
RETURNING *;

-- name: ListMetricSamples :many
SELECT *
FROM metric_samples
WHERE scope_type = $1
  AND scope_id = $2
  AND metric_name = $3
  AND sampled_at >= $4
ORDER BY sampled_at ASC
LIMIT $5;

-- name: GetLatestMetricSample :one
SELECT *
FROM metric_samples
WHERE scope_type = $1
  AND scope_id = $2
  AND metric_name = $3
ORDER BY sampled_at DESC
LIMIT 1;

-- name: ListLatestMetricSamplesForScope :many
SELECT DISTINCT ON (metric_name) *
FROM metric_samples
WHERE scope_type = $1
  AND scope_id = $2
ORDER BY metric_name, sampled_at DESC;

-- name: DeleteOldMetricSamples :exec
DELETE FROM metric_samples
WHERE sampled_at < $1;

-- name: DeleteMetricSamplesForScope :exec
DELETE FROM metric_samples
WHERE scope_type = $1
  AND scope_id = $2;

-- name: CreateNotificationChannel :one
INSERT INTO notification_channels (team_id, name, type, target, enabled)
VALUES ($1, $2, $3, $4, COALESCE(sqlc.narg(enabled), true))
RETURNING *;

-- name: ListNotificationChannelsByTeam :many
SELECT *
FROM notification_channels
WHERE team_id = $1
ORDER BY created_at DESC;

-- name: ListNotificationChannelsByIDs :many
SELECT *
FROM notification_channels
WHERE team_id = $1
  AND id = ANY($2::uuid[])
  AND enabled = true
ORDER BY created_at DESC;

-- name: CreateAlertRule :one
INSERT INTO alert_rules (
    team_id,
    scope_type,
    scope_id,
    name,
    metric_name,
    comparison,
    threshold,
    duration_seconds,
    severity,
    enabled,
    notification_channels
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE(sqlc.narg(enabled), true), $10)
RETURNING *;

-- name: ListAlertRulesByScope :many
SELECT *
FROM alert_rules
WHERE team_id = $1
  AND scope_type = $2
  AND scope_id = $3
ORDER BY created_at DESC;

-- name: ListAlertRulesByTeam :many
SELECT *
FROM alert_rules
WHERE team_id = $1
ORDER BY created_at DESC;

-- name: ListEnabledAlertRules :many
SELECT *
FROM alert_rules
WHERE enabled = true
ORDER BY created_at ASC;

-- name: GetAlertRule :one
SELECT *
FROM alert_rules
WHERE id = $1;

-- name: UpdateAlertRule :one
UPDATE alert_rules
SET name = $3,
    metric_name = $4,
    comparison = $5,
    threshold = $6,
    duration_seconds = $7,
    severity = $8,
    enabled = $9,
    notification_channels = $10,
    updated_at = now()
WHERE id = $1
  AND team_id = $2
RETURNING *;

-- name: UpdateAlertRuleState :one
UPDATE alert_rules
SET last_state = $2,
    last_value = $3,
    last_evaluated_at = now(),
    state_changed_at = CASE WHEN last_state <> $2 THEN now() ELSE state_changed_at END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteAlertRule :exec
DELETE FROM alert_rules
WHERE id = $1
  AND team_id = $2;

-- name: CreateAlertEvent :one
INSERT INTO alert_events (rule_id, team_id, scope_type, scope_id, state, metric_value, threshold, message, notified_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, sqlc.narg(notified_at))
RETURNING *;

-- name: ListAlertEventsByScope :many
SELECT *
FROM alert_events
WHERE team_id = $1
  AND scope_type = $2
  AND scope_id = $3
ORDER BY created_at DESC
LIMIT $4;

-- name: ListAlertEventsByTeam :many
SELECT *
FROM alert_events
WHERE team_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: IsAlertSilenced :one
SELECT EXISTS (
    SELECT 1
    FROM alert_silences
    WHERE team_id = $1
      AND starts_at <= now()
      AND ends_at > now()
      AND (
        rule_id = $2
        OR (rule_id IS NULL AND scope_type = $3 AND scope_id = $4)
      )
)::BOOLEAN;

-- name: CreateAlertSilence :one
INSERT INTO alert_silences (team_id, rule_id, scope_type, scope_id, reason, starts_at, ends_at)
VALUES ($1, sqlc.narg(rule_id), sqlc.narg(scope_type), sqlc.narg(scope_id), $2, COALESCE(sqlc.narg(starts_at), now()), $3)
RETURNING *;
