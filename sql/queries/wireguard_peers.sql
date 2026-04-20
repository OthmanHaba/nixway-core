-- name: CreateWireGuardPeer :one
INSERT INTO wireguard_peers (member_id, peer_member_id, status)
VALUES ($1, $2, 'pending') RETURNING *;

-- name: UpsertWireGuardPeer :exec
INSERT INTO wireguard_peers (member_id, peer_member_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (member_id, peer_member_id) DO UPDATE SET
    status = EXCLUDED.status,
    last_check_at = now();

-- name: UpdatePeerHealth :exec
UPDATE wireguard_peers SET
    status = $3,
    last_handshake_at = $4,
    last_check_at = now(),
    rtt_ms = $5
WHERE member_id = $1 AND peer_member_id = $2;

-- name: ListPeersByMember :many
SELECT wp.*, cm.wireguard_ip AS peer_ip, s.name AS peer_server_name
FROM wireguard_peers wp
JOIN cluster_members cm ON wp.peer_member_id = cm.id
JOIN servers s ON cm.server_id = s.id
WHERE wp.member_id = $1;

-- name: ListPeersByCluster :many
SELECT wp.*,
       cm_from.wireguard_ip AS from_ip, s_from.name AS from_server_name,
       cm_to.wireguard_ip AS to_ip, s_to.name AS to_server_name
FROM wireguard_peers wp
JOIN cluster_members cm_from ON wp.member_id = cm_from.id
JOIN cluster_members cm_to ON wp.peer_member_id = cm_to.id
JOIN servers s_from ON cm_from.server_id = s_from.id
JOIN servers s_to ON cm_to.server_id = s_to.id
WHERE cm_from.cluster_id = $1;

-- name: DeletePeersByMember :exec
DELETE FROM wireguard_peers WHERE member_id = $1 OR peer_member_id = $1;

-- name: GetPeerStatus :one
SELECT status FROM wireguard_peers WHERE member_id = $1 AND peer_member_id = $2;

-- name: CountFailedPeersByCluster :one
SELECT count(*) FROM wireguard_peers wp
JOIN cluster_members cm ON wp.member_id = cm.id
WHERE cm.cluster_id = $1 AND wp.status = 'failed';

-- name: CountTotalPeersByCluster :one
SELECT count(*) FROM wireguard_peers wp
JOIN cluster_members cm ON wp.member_id = cm.id
WHERE cm.cluster_id = $1;
