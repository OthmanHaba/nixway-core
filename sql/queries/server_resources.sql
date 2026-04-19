-- name: UpsertServerResources :exec
INSERT INTO server_resources (server_id, cpu_model, cpu_cores, memory_total, memory_available, kernel_version, docker_version, disks, network_interfaces, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
ON CONFLICT (server_id) DO UPDATE SET
    cpu_model = EXCLUDED.cpu_model,
    cpu_cores = EXCLUDED.cpu_cores,
    memory_total = EXCLUDED.memory_total,
    memory_available = EXCLUDED.memory_available,
    kernel_version = EXCLUDED.kernel_version,
    docker_version = EXCLUDED.docker_version,
    disks = EXCLUDED.disks,
    network_interfaces = EXCLUDED.network_interfaces,
    updated_at = now();

-- name: GetServerResources :one
SELECT * FROM server_resources WHERE server_id = $1;
