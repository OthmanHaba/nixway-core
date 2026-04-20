-- name: CreateProject :one
INSERT INTO projects (team_id, cluster_id, name, slug, description)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetProject :one
SELECT * FROM projects WHERE id = $1;

-- name: GetProjectByTeamAndSlug :one
SELECT * FROM projects WHERE team_id = $1 AND slug = $2;

-- name: ListProjectsByTeam :many
SELECT p.*, c.name AS cluster_name
FROM projects p
JOIN clusters c ON c.id = p.cluster_id
WHERE p.team_id = $1
ORDER BY p.created_at DESC;

-- name: UpdateProject :one
UPDATE projects
SET name = $2, description = $3, status = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;

-- name: CountProjectsByCluster :one
SELECT count(*) FROM projects WHERE cluster_id = $1;
