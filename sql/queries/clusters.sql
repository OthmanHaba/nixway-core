-- name: CreateCluster :one
INSERT INTO clusters (team_id, name, slug, description, region, cidr)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetClusterByID :one
SELECT * FROM clusters WHERE id = $1 AND team_id = $2;

-- name: GetClusterBySlug :one
SELECT * FROM clusters WHERE slug = $1 AND team_id = $2;

-- name: ListClustersByTeam :many
SELECT * FROM clusters WHERE team_id = $1 ORDER BY created_at DESC;

-- name: UpdateCluster :one
UPDATE clusters SET name = $3, description = $4, region = $5, updated_at = now()
WHERE id = $1 AND team_id = $2 RETURNING *;

-- name: UpdateClusterStatus :exec
UPDATE clusters SET status = $2, updated_at = now() WHERE id = $1;

-- name: DeleteCluster :exec
DELETE FROM clusters WHERE id = $1 AND team_id = $2;

-- name: ListAllClusterCIDRs :many
SELECT cidr FROM clusters;

-- name: CountClusterMembers :one
SELECT count(*) FROM cluster_members WHERE cluster_id = $1;
