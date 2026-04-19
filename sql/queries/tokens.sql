-- name: CreateAPIToken :one
INSERT INTO api_tokens (team_id, user_id, name, token_hash, scopes, expires_at)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetAPITokenByHash :one
SELECT * FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: ListAPITokensByTeam :many
SELECT id, team_id, user_id, name, scopes, last_used_at, expires_at, created_at
FROM api_tokens
WHERE team_id = $1 AND revoked_at IS NULL
ORDER BY created_at DESC;

-- name: RevokeAPIToken :exec
UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND team_id = $2;

-- name: UpdateTokenLastUsed :exec
UPDATE api_tokens SET last_used_at = now() WHERE id = $1;
