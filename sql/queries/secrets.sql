-- name: CreateSecret :one
INSERT INTO secrets (team_id, environment, key, encrypted_value, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $5) RETURNING *;

-- name: GetSecretByID :one
SELECT * FROM secrets WHERE id = $1 AND team_id = $2;

-- name: GetSecretByKey :one
SELECT * FROM secrets WHERE team_id = $1 AND environment = $2 AND key = $3;

-- name: ListSecrets :many
SELECT id, team_id, environment, key, version, revealed_at, created_by, updated_by, created_at, updated_at
FROM secrets
WHERE team_id = $1 AND environment = $2
ORDER BY key;

-- name: ListSecretsByTeam :many
SELECT id, team_id, environment, key, version, revealed_at, created_by, updated_by, created_at, updated_at
FROM secrets
WHERE team_id = $1
ORDER BY environment, key;

-- name: UpdateSecretValue :one
UPDATE secrets SET
    encrypted_value = $3,
    version = version + 1,
    revealed_at = NULL,
    updated_by = $4,
    updated_at = now()
WHERE id = $1 AND team_id = $2 RETURNING *;

-- name: SetSecretRevealedAt :exec
UPDATE secrets SET revealed_at = now() WHERE id = $1;

-- name: DeleteSecret :exec
DELETE FROM secrets WHERE id = $1 AND team_id = $2;

-- name: DeleteSecretByKey :exec
DELETE FROM secrets WHERE team_id = $1 AND environment = $2 AND key = $3;
