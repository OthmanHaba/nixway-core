-- name: CreateInvite :one
INSERT INTO team_invites (team_id, email, role, token, invited_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetInviteByToken :one
SELECT * FROM team_invites WHERE token = $1 AND expires_at > now();

-- name: ListInvitesByTeam :many
SELECT ti.*, u.name AS inviter_name FROM team_invites ti
JOIN users u ON ti.invited_by = u.id
WHERE ti.team_id = $1 AND ti.expires_at > now()
ORDER BY ti.created_at DESC;

-- name: DeleteInvite :exec
DELETE FROM team_invites WHERE id = $1;

-- name: DeleteInviteByToken :exec
DELETE FROM team_invites WHERE token = $1;

-- name: DeleteExpiredInvites :execrows
DELETE FROM team_invites WHERE expires_at <= now();
