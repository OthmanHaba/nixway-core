-- name: CreateTeam :one
INSERT INTO teams (name, slug) VALUES ($1, $2) RETURNING *;

-- name: GetTeamByID :one
SELECT * FROM teams WHERE id = $1;

-- name: GetTeamBySlug :one
SELECT * FROM teams WHERE slug = $1;

-- name: ListTeamsByUser :many
SELECT t.* FROM teams t
JOIN team_memberships tm ON t.id = tm.team_id
WHERE tm.user_id = $1
ORDER BY t.created_at DESC;

-- name: UpdateTeam :one
UPDATE teams SET name = $2, slug = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteTeam :exec
DELETE FROM teams WHERE id = $1;
