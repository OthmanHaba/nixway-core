-- name: CreateVolume :one
INSERT INTO volumes (team_id, cluster_id, server_id, name, size_gb, filesystem, status, host_path)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetVolume :one
SELECT * FROM volumes WHERE id = $1 AND team_id = $2;

-- name: GetVolumeAnyTeam :one
SELECT * FROM volumes WHERE id = $1;

-- name: ListVolumesByTeam :many
SELECT * FROM volumes WHERE team_id = $1 ORDER BY created_at DESC;

-- name: ListVolumesByCluster :many
SELECT * FROM volumes WHERE team_id = $1 AND cluster_id = $2 ORDER BY created_at DESC;

-- name: ListVolumesByServer :many
SELECT * FROM volumes WHERE team_id = $1 AND server_id = $2 ORDER BY created_at DESC;

-- name: ListVolumesByStatus :many
SELECT * FROM volumes WHERE team_id = $1 AND status = $2 ORDER BY created_at DESC;

-- name: UpdateVolumeStatus :one
UPDATE volumes
SET status = $3, updated_at = now()
WHERE id = $1 AND team_id = $2
RETURNING *;

-- name: UpdateVolumeStatusAnyTeam :exec
UPDATE volumes
SET status = $2, updated_at = now()
WHERE id = $1;

-- name: UpdateVolumeAttachment :one
UPDATE volumes
SET mount_path = sqlc.narg(mount_path),
    container_name = sqlc.narg(container_name),
    status = $3,
    updated_at = now()
WHERE id = $1 AND team_id = $2
RETURNING *;

-- name: UpdateVolumeUsage :exec
UPDATE volumes
SET used_bytes = $2, updated_at = now()
WHERE id = $1;

-- name: UpdateVolumeSize :one
UPDATE volumes
SET size_gb = $3, updated_at = now()
WHERE id = $1 AND team_id = $2
RETURNING *;

-- name: UpdateVolumeServer :one
UPDATE volumes
SET server_id = $3, status = $4, updated_at = now()
WHERE id = $1 AND team_id = $2
RETURNING *;

-- name: UpdateVolumeHostPath :exec
UPDATE volumes
SET host_path = $2, updated_at = now()
WHERE id = $1;

-- name: DeleteVolume :exec
DELETE FROM volumes WHERE id = $1 AND team_id = $2;

-- name: CreateVolumeSnapshot :one
INSERT INTO volume_snapshots (volume_id, size_bytes, storage_type, storage_path)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListVolumeSnapshots :many
SELECT * FROM volume_snapshots WHERE volume_id = $1 ORDER BY created_at DESC;

-- name: GetVolumeSnapshot :one
SELECT * FROM volume_snapshots WHERE id = $1;

-- name: DeleteVolumeSnapshot :exec
DELETE FROM volume_snapshots WHERE id = $1;
