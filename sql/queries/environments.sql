-- name: CreateEnvironment :one
INSERT INTO environments (project_id, name, slug, is_production)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetEnvironment :one
SELECT * FROM environments WHERE id = $1;

-- name: GetEnvironmentBySlug :one
SELECT * FROM environments WHERE project_id = $1 AND slug = $2;

-- name: ListEnvironmentsByProject :many
SELECT * FROM environments
WHERE project_id = $1
ORDER BY is_production DESC, name ASC;

-- name: DeleteEnvironment :exec
DELETE FROM environments WHERE id = $1 AND is_production = false;
