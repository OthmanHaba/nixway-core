-- name: CreateMembership :one
INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, $3) RETURNING *;

-- name: GetMembership :one
SELECT * FROM team_memberships WHERE team_id = $1 AND user_id = $2;

-- name: ListMembersByTeam :many
SELECT tm.*, u.email, u.name AS user_name FROM team_memberships tm
JOIN users u ON tm.user_id = u.id
WHERE tm.team_id = $1
ORDER BY tm.created_at;

-- name: UpdateMemberRole :exec
UPDATE team_memberships SET role = $3 WHERE team_id = $1 AND user_id = $2;

-- name: DeleteMembership :exec
DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2;

-- name: CountOwners :one
SELECT COUNT(*) FROM team_memberships WHERE team_id = $1 AND role = 'owner';
