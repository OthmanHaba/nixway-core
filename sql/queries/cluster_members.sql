-- name: CreateClusterMember :one
INSERT INTO cluster_members (cluster_id, server_id, wireguard_ip, wireguard_public_key, wireguard_endpoint, listen_port)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetClusterMemberByID :one
SELECT * FROM cluster_members WHERE id = $1;

-- name: GetClusterMemberByServerID :one
SELECT * FROM cluster_members WHERE server_id = $1;

-- name: ListClusterMembers :many
SELECT cm.*, s.name AS server_name, s.public_ip, s.status AS server_status
FROM cluster_members cm
JOIN servers s ON cm.server_id = s.id
WHERE cm.cluster_id = $1
ORDER BY cm.joined_at;

-- name: ListClusterMemberIPs :many
SELECT wireguard_ip FROM cluster_members WHERE cluster_id = $1;

-- name: DeleteClusterMember :exec
DELETE FROM cluster_members WHERE cluster_id = $1 AND server_id = $2;

-- name: DeleteClusterMemberByID :exec
DELETE FROM cluster_members WHERE id = $1;

-- name: UpdateClusterMemberPublicKey :exec
UPDATE cluster_members SET wireguard_public_key = $2 WHERE id = $1;

-- name: GetClusterMembersForMesh :many
SELECT cm.id, cm.cluster_id, cm.server_id, cm.wireguard_ip, cm.wireguard_public_key,
       cm.wireguard_endpoint, cm.listen_port, s.name AS server_name, s.agent_id
FROM cluster_members cm
JOIN servers s ON cm.server_id = s.id
WHERE cm.cluster_id = $1;

-- name: GetClusterMemberByClusterAndIP :one
SELECT * FROM cluster_members WHERE cluster_id = $1 AND wireguard_ip = $2;

-- name: UpdateServerClusterID :exec
UPDATE servers SET cluster_id = $2 WHERE id = $1;

-- name: ClearServerClusterID :exec
UPDATE servers SET cluster_id = NULL WHERE id = $1;
