-- name: CreateUser :one
INSERT INTO users (email, password_hash, name, email_verify_token, email_verify_expires)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByVerifyToken :one
SELECT * FROM users WHERE email_verify_token = $1 AND email_verify_expires > now();

-- name: VerifyUserEmail :exec
UPDATE users SET email_verified = true, email_verify_token = NULL, email_verify_expires = NULL, updated_at = now()
WHERE id = $1;

-- name: SetPasswordResetToken :exec
UPDATE users SET password_reset_token = $2, password_reset_expires = $3, updated_at = now()
WHERE id = $1;

-- name: GetUserByResetToken :one
SELECT * FROM users WHERE password_reset_token = $1 AND password_reset_expires > now();

-- name: UpdatePassword :exec
UPDATE users SET password_hash = $2, password_reset_token = NULL, password_reset_expires = NULL, updated_at = now()
WHERE id = $1;
