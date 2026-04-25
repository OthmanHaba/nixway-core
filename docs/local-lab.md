# Local Server Lab

Use the local lab when you want realistic Nixway server testing without renting VPSs. The lab creates Ubuntu VMs with Multipass, installs SSH and Docker, and prints the connection details you can paste into the Nixway server onboarding UI.

## Requirements

- macOS or Linux host
- [Multipass](https://documentation.ubuntu.com/multipass/)
- Docker Desktop or Docker Engine if you want the optional local registry

On macOS:

```bash
brew install --cask multipass
```

## Quick Start

```bash
make build-agent
make lab-up
make lab-info
```

The default lab creates two VMs:

- `nx-node-1`
- `nx-node-2`

Each VM is bootstrapped with:

- `openssh-server`
- Docker
- Git, curl, CA certificates
- the lab SSH key at `.lab/id_ed25519`

## Add A VM As A Nixway Server

Run:

```bash
make lab-info
```

Use the printed values:

- Hostname/Public IP: the VM IP
- SSH user: `ubuntu`
- SSH port: `22`
- SSH private key: `.lab/id_ed25519`

After the server is added, run provisioning from the UI. The `agent` component downloads the current binary from this control plane using `/agent/download/{arch}` and starts `nixway-agent` under systemd.

## Common Commands

```bash
scripts/lab up 3          # create and bootstrap 3 VMs
scripts/lab bootstrap 3   # re-run package/key setup
scripts/lab info 3        # print connection details
scripts/lab status        # list lab VM status
scripts/lab ssh nx-node-1 # SSH into a VM
scripts/lab down 3        # stop VMs
scripts/lab destroy 3     # delete VMs and purge Multipass state
```

## Local Registry

Start a registry on the host:

```bash
make lab-registry
```

It listens on `localhost:5001`. If your VMs need to pull from it, configure Docker inside the VMs with your host LAN IP:

```json
{
  "insecure-registries": ["<host-lan-ip>:5001"]
}
```

Then restart Docker in the VM:

```bash
sudo systemctl restart docker
```

## Useful Environment Variables

```bash
NIXWAY_LAB_COUNT=3 make lab-up
NIXWAY_LAB_PREFIX=lab-node scripts/lab up 2
NIXWAY_LAB_CPUS=4 NIXWAY_LAB_MEMORY=6G scripts/lab up 1
```

Defaults:

- prefix: `nx-node`
- count: `2`
- CPUs: `2`
- memory: `3G`
- disk: `20G`
- image: `24.04`

## Testing Checklist

1. Run `make up` for local Postgres/Redis services.
2. Run `make build-agent` so `/agent/download/{arch}` serves current binaries.
3. Run the API and web app.
4. Run `make lab-up`.
5. Add each VM as a Nixway server.
6. Provision Docker, Traefik, builders, and agent.
7. Confirm the server becomes online.
8. Test terminal, server logs, builds, deploys, cleanup, and agent update.
