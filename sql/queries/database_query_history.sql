-- name: CreateDatabaseQueryHistory :one
INSERT INTO database_query_history (
    user_id, database_id, query_text, write_mode,
    execution_time_ms, row_count, error
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListDatabaseQueryHistoryByUser :many
SELECT * FROM database_query_history
WHERE user_id = @user_id
  AND (sqlc.narg('database_id')::UUID IS NULL OR database_id = sqlc.narg('database_id')::UUID)
ORDER BY created_at DESC
LIMIT @limit_count;

-- name: DeleteDatabaseQueryHistoryOlderThan :exec
DELETE FROM database_query_history WHERE created_at < $1;
