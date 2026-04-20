-- name: CreateGitHubApp :one
INSERT INTO github_apps (team_id, app_id, app_name, app_slug, client_id, client_secret, private_key, webhook_secret, html_url)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: GetGitHubAppByTeam :one
SELECT * FROM github_apps WHERE team_id = $1;

-- name: GetGitHubAppByID :one
SELECT * FROM github_apps WHERE id = $1;

-- name: GetGitHubAppByAppID :one
SELECT * FROM github_apps WHERE app_id = $1;

-- name: DeleteGitHubApp :exec
DELETE FROM github_apps WHERE id = $1 AND team_id = $2;

-- name: CreateGitHubInstallation :one
INSERT INTO github_installations (github_app_id, installation_id, account_login, account_type, target_type)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: GetGitHubInstallation :one
SELECT * FROM github_installations WHERE github_app_id = $1 AND installation_id = $2;

-- name: ListGitHubInstallations :many
SELECT * FROM github_installations WHERE github_app_id = $1 ORDER BY created_at;

-- name: DeleteGitHubInstallation :exec
DELETE FROM github_installations WHERE github_app_id = $1 AND installation_id = $2;

-- name: UpdateGitHubInstallationSuspended :exec
UPDATE github_installations SET suspended_at = $3, updated_at = now()
WHERE github_app_id = $1 AND installation_id = $2;
