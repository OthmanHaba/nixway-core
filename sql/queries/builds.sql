-- name: CreateBuild :one
INSERT INTO builds (app_id, environment_id, trigger_type, commit_sha, commit_message, branch, builder)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetBuild :one
SELECT * FROM builds WHERE id = $1;

-- name: ListBuildsByApp :many
SELECT * FROM builds
WHERE app_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: UpdateBuildStatus :exec
UPDATE builds
SET status = $2, started_at = COALESCE(started_at, $3), error = $4
WHERE id = $1;

-- name: CompleteBuild :exec
UPDATE builds
SET status = $2, image_tag = $3, server_id = $4, completed_at = now(), error = $5
WHERE id = $1;

-- name: AppendBuildLogs :exec
UPDATE builds SET logs = logs || $2 WHERE id = $1;

-- name: GetLatestSuccessfulBuild :one
SELECT * FROM builds
WHERE app_id = $1 AND environment_id = $2 AND status = 'built'
ORDER BY created_at DESC
LIMIT 1;
