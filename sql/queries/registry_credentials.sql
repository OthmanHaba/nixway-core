-- name: CreateRegistryCredential :one
INSERT INTO registry_credentials (team_id, name, registry_type, registry_url, username, password, region, aws_access_key_id, aws_secret_access_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: GetRegistryCredentialByID :one
SELECT * FROM registry_credentials WHERE id = $1 AND team_id = $2;

-- name: ListRegistryCredentials :many
SELECT * FROM registry_credentials WHERE team_id = $1 ORDER BY created_at;

-- name: UpdateRegistryCredential :one
UPDATE registry_credentials SET
    name = $3,
    registry_type = $4,
    registry_url = $5,
    username = $6,
    password = $7,
    region = $8,
    aws_access_key_id = $9,
    aws_secret_access_key = $10,
    validated_at = $11,
    updated_at = now()
WHERE id = $1 AND team_id = $2 RETURNING *;

-- name: UpdateRegistryValidatedAt :exec
UPDATE registry_credentials SET validated_at = now() WHERE id = $1;

-- name: DeleteRegistryCredential :exec
DELETE FROM registry_credentials WHERE id = $1 AND team_id = $2;
