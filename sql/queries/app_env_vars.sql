-- name: UpsertAppEnvVar :one
INSERT INTO app_env_vars (app_id, environment_id, key, encrypted_value, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $5)
ON CONFLICT (app_id, environment_id, key) DO UPDATE SET
    encrypted_value = EXCLUDED.encrypted_value,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
RETURNING *;

-- name: GetAppEnvVarByID :one
SELECT * FROM app_env_vars WHERE id = $1 AND app_id = $2;

-- name: ListAppEnvVars :many
SELECT id, app_id, environment_id, key, created_by, updated_by, created_at, updated_at
FROM app_env_vars
WHERE app_id = $1 AND environment_id = $2
ORDER BY key;

-- name: ListAppEnvVarsWithValues :many
SELECT * FROM app_env_vars
WHERE app_id = $1 AND environment_id = $2
ORDER BY key;

-- name: DeleteAppEnvVar :exec
DELETE FROM app_env_vars WHERE id = $1 AND app_id = $2;
