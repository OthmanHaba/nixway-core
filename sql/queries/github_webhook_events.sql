-- name: CreateWebhookEvent :one
INSERT INTO github_webhook_events (github_app_id, event_type, action, delivery_id, payload)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: GetWebhookEventByDeliveryID :one
SELECT * FROM github_webhook_events WHERE delivery_id = $1;

-- name: ListWebhookEvents :many
SELECT * FROM github_webhook_events
WHERE github_app_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListWebhookEventsByType :many
SELECT * FROM github_webhook_events
WHERE github_app_id = $1 AND event_type = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;

-- name: MarkWebhookEventProcessed :exec
UPDATE github_webhook_events SET processed = true WHERE id = $1;

-- name: DeleteOldWebhookEvents :exec
DELETE FROM github_webhook_events WHERE created_at < $1;
