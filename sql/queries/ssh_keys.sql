-- name: CreateSSHKey :one
INSERT INTO ssh_keys (team_id, name, public_key, private_key_encrypted, key_type, fingerprint)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetSSHKeyByID :one
SELECT * FROM ssh_keys WHERE id = $1 AND team_id = $2;

-- name: ListSSHKeysByTeam :many
SELECT id, team_id, name, public_key, key_type, fingerprint, created_at, updated_at
FROM ssh_keys WHERE team_id = $1 ORDER BY created_at DESC;

-- name: DeleteSSHKey :exec
DELETE FROM ssh_keys WHERE id = $1 AND team_id = $2;

-- name: AttachSSHKeyToServer :exec
INSERT INTO server_ssh_keys (server_id, ssh_key_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DetachSSHKeyFromServer :exec
DELETE FROM server_ssh_keys WHERE server_id = $1 AND ssh_key_id = $2;
