-- name: CreateDatabaseSavedQuery :one
INSERT INTO database_saved_queries (project_id, user_id, database_id, name, query_text)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetDatabaseSavedQuery :one
SELECT * FROM database_saved_queries WHERE id = $1;

-- name: ListDatabaseSavedQueriesByProject :many
SELECT * FROM database_saved_queries
WHERE project_id = $1
ORDER BY name ASC;

-- name: UpdateDatabaseSavedQuery :one
UPDATE database_saved_queries
SET name = $2, query_text = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteDatabaseSavedQuery :exec
DELETE FROM database_saved_queries WHERE id = $1;
