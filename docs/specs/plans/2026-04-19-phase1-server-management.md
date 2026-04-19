# Phase 1: Server Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server lifecycle management — SSH keys, server onboarding with agent auto-install, heartbeat status tracking, resource inventory, tagging, provisioning engine, and auto-discovery.

**Architecture:** Extends Phase 0 foundation. New DB tables for servers/keys/tags/resources/provisioning. Agent protocol extended with resource reports + provisioning commands. Provisioning scripts embedded in control plane via Go embed, pushed to agents via gRPC. SSE for real-time log streaming via Redis pub/sub.

**Tech Stack:** golang.org/x/crypto/ssh, golang.org/x/crypto/nacl/secretbox, golang.org/x/crypto/hkdf, Go embed, SSE (text/event-stream), Redis pub/sub

---

## Existing Codebase Reference

- **Router**: `internal/api/router.go` — `NewRouter(queries, sessions, emailSender, auditWriter, cfg, logger) http.Handler`
- **DB**: `internal/db/` — sqlc generated, `db.New(pool) *Queries`
- **Agent server**: `internal/agent/server.go` — `Server` with `Connect()` + `Register()` RPCs
- **ConnManager**: `internal/agent/connmanager.go` — `Register()`, `Heartbeat()`, `Disconnect()`, `GetState()`, `ListOnline()`
- **Proto**: `proto/agent/v1/agent.proto` — AgentMessage (heartbeat, exec_output, health_report, file_chunk), ControlMessage (exec_command, file_transfer, cert_rotation)
- **Config**: `internal/config/config.go` — `Config` struct
- **Audit**: `internal/audit/audit.go` — `Writer.Log(ctx, Entry)`
- **Respond**: `internal/api/respond/respond.go` — `JSON()`, `Error()`, `DecodeJSON()`
- **Handlers follow pattern**: struct with dependencies, methods per endpoint
- **pgtype conversions**: `pgtype.UUID{Bytes: id, Valid: true}`, `pgtype.Timestamptz{Time: t, Valid: true}`

---

## File Map

### New Files

```
internal/
├── crypto/
│   ├── secretbox.go              # Encrypt/decrypt with NaCl secretbox + HKDF
│   └── secretbox_test.go
├── ssh/
│   ├── client.go                 # SSH client (connect, run command, push file)
│   ├── keygen.go                 # Generate ed25519/RSA keypairs
│   ├── keygen_test.go
│   ├── fingerprint.go            # Compute SSH key fingerprints
│   └── fingerprint_test.go
├── provisioner/
│   ├── provisioner.go            # Provisioning orchestrator
│   ├── scripts/
│   │   ├── docker.sh
│   │   ├── traefik.sh
│   │   ├── nixpacks.sh
│   │   ├── buildpacks.sh
│   │   └── railpack.sh
│   └── embed.go                  # Go embed directive
├── discovery/
│   ├── discovery.go              # Auto-discovery engine
│   └── discovery_test.go
├── server/
│   ├── status.go                 # Status watcher goroutine
│   └── onboarding.go             # Server onboarding orchestrator
├── api/handler/
│   ├── sshkey.go                 # SSH key CRUD handlers
│   ├── server_handler.go         # Server CRUD + listing handlers
│   ├── provision.go              # Provisioning handlers + SSE stream
│   ├── tag.go                    # Tag CRUD handlers
│   └── discover.go               # Auto-discovery handler

sql/
├── migrations/
│   └── 00002_server_management.sql
├── queries/
│   ├── ssh_keys.sql
│   ├── servers.sql
│   ├── server_tags.sql
│   ├── server_resources.sql
│   └── provisioning_jobs.sql

proto/agent/v1/
└── agent.proto                   # Extended with ResourceReport, ProvisionCommand, etc.

apps/web/src/
├── routes/_app/teams/$teamId/
│   ├── servers/
│   │   ├── index.tsx             # Server list
│   │   └── $serverId.tsx         # Server detail (tabs)
│   └── ssh-keys.tsx              # SSH key management
├── hooks/
│   └── use-sse.ts                # SSE hook for log streaming
└── lib/
    └── types.ts                  # Extended with Server, SSHKey, etc.
```

### Modified Files

```
internal/config/config.go         # Add MasterKey field
internal/api/router.go            # Register new routes
internal/agent/server.go          # Handle ResourceReport, ProvisionOutput
internal/agent/connmanager.go     # Add resource data to ConnState
apps/api/main.go                  # Wire new handlers
apps/agent/main.go                # Resource collection, provisioning handler
apps/agent/heartbeat.go           # Extended heartbeat with resources
sqlc.yaml                         # (already configured, just regenerate)
```

---

## Task 1: Database Migration — Server Management Tables

**Files:**
- Create: `sql/migrations/00002_server_management.sql`

- [ ] **Step 1: Write migration**

```sql
-- +goose Up

CREATE TABLE ssh_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key_encrypted BYTEA NOT NULL,
    key_type TEXT NOT NULL CHECK (key_type IN ('ed25519', 'rsa')),
    fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id TEXT,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    public_ip INET NOT NULL,
    ssh_port INT NOT NULL DEFAULT 22,
    ssh_user TEXT NOT NULL DEFAULT 'root',
    os TEXT,
    os_version TEXT,
    arch TEXT,
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning', 'online', 'degraded', 'offline')),
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE server_ssh_keys (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    ssh_key_id UUID NOT NULL REFERENCES ssh_keys(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, ssh_key_id)
);

CREATE TABLE server_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE (server_id, key)
);

CREATE TABLE server_resources (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    cpu_model TEXT,
    cpu_cores INT,
    memory_total BIGINT,
    memory_available BIGINT,
    kernel_version TEXT,
    docker_version TEXT,
    disks JSONB,
    network_interfaces JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provisioning_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    components TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    logs TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_servers_team ON servers(team_id);
CREATE INDEX idx_servers_agent ON servers(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_servers_status ON servers(team_id, status);
CREATE INDEX idx_ssh_keys_team ON ssh_keys(team_id);
CREATE INDEX idx_server_tags_server ON server_tags(server_id);
CREATE INDEX idx_provisioning_jobs_server ON provisioning_jobs(server_id);

-- +goose Down
DROP TABLE IF EXISTS provisioning_jobs;
DROP TABLE IF EXISTS server_resources;
DROP TABLE IF EXISTS server_tags;
DROP TABLE IF EXISTS server_ssh_keys;
DROP TABLE IF EXISTS servers;
DROP TABLE IF EXISTS ssh_keys;
```

- [ ] **Step 2: Verify migration syntax**

Run: `goose -dir sql/migrations postgres "$DATABASE_URL" up`
Expected: `OK 00002_server_management.sql`

- [ ] **Step 3: Commit**

```bash
git add sql/migrations/00002_server_management.sql
git commit -m "feat: add server management database tables"
```

---

## Task 2: sqlc Queries for Server Management

**Files:**
- Create: `sql/queries/ssh_keys.sql`, `sql/queries/servers.sql`, `sql/queries/server_tags.sql`, `sql/queries/server_resources.sql`, `sql/queries/provisioning_jobs.sql`

- [ ] **Step 1: Write SSH key queries**

`sql/queries/ssh_keys.sql`:
```sql
-- name: CreateSSHKey :one
INSERT INTO ssh_keys (team_id, name, public_key, private_key_encrypted, key_type, fingerprint)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetSSHKeyByID :one
SELECT * FROM ssh_keys WHERE id = $1 AND team_id = $2;

-- name: ListSSHKeysByTeam :many
SELECT id, team_id, name, public_key, key_type, fingerprint, created_at, updated_at
FROM ssh_keys WHERE team_id = $1 ORDER BY created_at DESC;

-- name: DeleteSSHKey :exec
DELETE FROM ssh_keys WHERE id = $1 AND team_id = $2;

-- name: ListSSHKeysByServer :many
SELECT sk.* FROM ssh_keys sk
JOIN server_ssh_keys ssk ON sk.id = ssk.ssh_key_id
WHERE ssk.server_id = $1;

-- name: AttachSSHKeyToServer :exec
INSERT INTO server_ssh_keys (server_id, ssh_key_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DetachSSHKeyFromServer :exec
DELETE FROM server_ssh_keys WHERE server_id = $1 AND ssh_key_id = $2;
```

- [ ] **Step 2: Write server queries**

`sql/queries/servers.sql`:
```sql
-- name: CreateServer :one
INSERT INTO servers (team_id, name, hostname, public_ip, ssh_port, ssh_user, os, os_version, arch, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;

-- name: GetServerByID :one
SELECT * FROM servers WHERE id = $1 AND team_id = $2;

-- name: GetServerByAgentID :one
SELECT * FROM servers WHERE agent_id = $1;

-- name: ListServersByTeam :many
SELECT * FROM servers WHERE team_id = $1 ORDER BY created_at DESC;

-- name: UpdateServerStatus :exec
UPDATE servers SET status = $2, last_seen_at = $3, updated_at = now() WHERE id = $1;

-- name: UpdateServerAgentID :exec
UPDATE servers SET agent_id = $2, status = 'online', last_seen_at = now(), updated_at = now() WHERE id = $1;

-- name: UpdateServerOS :exec
UPDATE servers SET os = $2, os_version = $3, arch = $4, updated_at = now() WHERE id = $1;

-- name: DeleteServer :exec
DELETE FROM servers WHERE id = $1 AND team_id = $2;

-- name: ListServersNeedingStatusUpdate :many
SELECT id, status, last_seen_at FROM servers
WHERE status IN ('online', 'degraded') AND team_id IS NOT NULL;

-- name: ListServersByTeamWithTag :many
SELECT s.* FROM servers s
JOIN server_tags st ON s.id = st.server_id
WHERE s.team_id = $1 AND st.key = $2 AND st.value = $3
ORDER BY s.created_at DESC;
```

- [ ] **Step 3: Write tag queries**

`sql/queries/server_tags.sql`:
```sql
-- name: SetServerTag :one
INSERT INTO server_tags (server_id, key, value)
VALUES ($1, $2, $3)
ON CONFLICT (server_id, key) DO UPDATE SET value = EXCLUDED.value
RETURNING *;

-- name: ListServerTags :many
SELECT * FROM server_tags WHERE server_id = $1 ORDER BY key;

-- name: DeleteServerTag :exec
DELETE FROM server_tags WHERE server_id = $1 AND key = $2;
```

- [ ] **Step 4: Write resource queries**

`sql/queries/server_resources.sql`:
```sql
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
```

- [ ] **Step 5: Write provisioning queries**

`sql/queries/provisioning_jobs.sql`:
```sql
-- name: CreateProvisioningJob :one
INSERT INTO provisioning_jobs (server_id, components, status)
VALUES ($1, $2, 'pending') RETURNING *;

-- name: GetProvisioningJob :one
SELECT * FROM provisioning_jobs WHERE id = $1;

-- name: GetLatestProvisioningJob :one
SELECT * FROM provisioning_jobs WHERE server_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: UpdateProvisioningJobStatus :exec
UPDATE provisioning_jobs SET status = $2, started_at = $3, completed_at = $4, error = $5 WHERE id = $1;

-- name: AppendProvisioningLog :exec
UPDATE provisioning_jobs SET logs = logs || $2 WHERE id = $1;
```

- [ ] **Step 6: Regenerate sqlc**

```bash
sqlc generate
cd internal && go build ./db/
```

- [ ] **Step 7: Commit**

```bash
git add sql/queries/ internal/db/
git commit -m "feat: add sqlc queries for server management"
```

---

## Task 3: Crypto — Secretbox Encryption

**Files:**
- Create: `internal/crypto/secretbox.go`, `internal/crypto/secretbox_test.go`

- [ ] **Step 1: Write test**

```go
package crypto_test

import (
	"testing"

	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	masterKey := crypto.GenerateMasterKey()
	teamID := "team-123"

	plaintext := []byte("ssh private key content here")
	encrypted, err := crypto.Encrypt(plaintext, masterKey, teamID)
	require.NoError(t, err)
	assert.NotEqual(t, plaintext, encrypted)

	decrypted, err := crypto.Decrypt(encrypted, masterKey, teamID)
	require.NoError(t, err)
	assert.Equal(t, plaintext, decrypted)
}

func TestDecryptWrongKey(t *testing.T) {
	key1 := crypto.GenerateMasterKey()
	key2 := crypto.GenerateMasterKey()

	encrypted, err := crypto.Encrypt([]byte("secret"), key1, "team-1")
	require.NoError(t, err)

	_, err = crypto.Decrypt(encrypted, key2, "team-1")
	assert.Error(t, err)
}

func TestDecryptWrongTeam(t *testing.T) {
	key := crypto.GenerateMasterKey()

	encrypted, err := crypto.Encrypt([]byte("secret"), key, "team-1")
	require.NoError(t, err)

	_, err = crypto.Decrypt(encrypted, key, "team-2")
	assert.Error(t, err)
}
```

- [ ] **Step 2: Write implementation**

```go
package crypto

import (
	"crypto/rand"
	"errors"
	"io"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/nacl/secretbox"
	"crypto/sha256"
)

const keySize = 32
const nonceSize = 24

func GenerateMasterKey() [keySize]byte {
	var key [keySize]byte
	if _, err := rand.Read(key[:]); err != nil {
		panic(err)
	}
	return key
}

func deriveKey(masterKey [keySize]byte, context string) [keySize]byte {
	var derived [keySize]byte
	r := hkdf.New(sha256.New, masterKey[:], []byte("nixway-secretbox"), []byte(context))
	if _, err := io.ReadFull(r, derived[:]); err != nil {
		panic(err)
	}
	return derived
}

func Encrypt(plaintext []byte, masterKey [keySize]byte, context string) ([]byte, error) {
	key := deriveKey(masterKey, context)
	var nonce [nonceSize]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, err
	}
	encrypted := secretbox.Seal(nonce[:], plaintext, &nonce, &key)
	return encrypted, nil
}

func Decrypt(ciphertext []byte, masterKey [keySize]byte, context string) ([]byte, error) {
	key := deriveKey(masterKey, context)
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	var nonce [nonceSize]byte
	copy(nonce[:], ciphertext[:nonceSize])
	decrypted, ok := secretbox.Open(nil, ciphertext[nonceSize:], &nonce, &key)
	if !ok {
		return nil, errors.New("decryption failed")
	}
	return decrypted, nil
}

func MasterKeyFromHex(hex string) ([keySize]byte, error) {
	var key [keySize]byte
	if len(hex) != keySize*2 {
		return key, errors.New("master key must be 64 hex characters")
	}
	for i := 0; i < keySize; i++ {
		b, err := hexByte(hex[i*2], hex[i*2+1])
		if err != nil {
			return key, err
		}
		key[i] = b
	}
	return key, nil
}

func hexByte(hi, lo byte) (byte, error) {
	h, err := hexNibble(hi)
	if err != nil {
		return 0, err
	}
	l, err := hexNibble(lo)
	if err != nil {
		return 0, err
	}
	return h<<4 | l, nil
}

func hexNibble(b byte) (byte, error) {
	switch {
	case b >= '0' && b <= '9':
		return b - '0', nil
	case b >= 'a' && b <= 'f':
		return b - 'a' + 10, nil
	case b >= 'A' && b <= 'F':
		return b - 'A' + 10, nil
	default:
		return 0, errors.New("invalid hex character")
	}
}
```

- [ ] **Step 3: Install dependencies and run tests**

```bash
cd internal && go get golang.org/x/crypto/nacl/secretbox golang.org/x/crypto/hkdf
cd internal && go test ./crypto/ -v
```

- [ ] **Step 4: Commit**

```bash
git add internal/crypto/
git commit -m "feat: add NaCl secretbox encryption with per-team key derivation"
```

---

## Task 4: SSH Key Generation + Fingerprinting

**Files:**
- Create: `internal/ssh/keygen.go`, `internal/ssh/keygen_test.go`, `internal/ssh/fingerprint.go`, `internal/ssh/fingerprint_test.go`

- [ ] **Step 1: Write keygen test**

```go
package ssh_test

import (
	"testing"

	"github.com/othmanhaba/nixway-core/internal/ssh"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateEd25519(t *testing.T) {
	pub, priv, err := ssh.GenerateKeyPair("ed25519")
	require.NoError(t, err)
	assert.Contains(t, string(pub), "ssh-ed25519")
	assert.Contains(t, string(priv), "OPENSSH PRIVATE KEY")
}

func TestGenerateRSA(t *testing.T) {
	pub, priv, err := ssh.GenerateKeyPair("rsa")
	require.NoError(t, err)
	assert.Contains(t, string(pub), "ssh-rsa")
	assert.Contains(t, string(priv), "RSA PRIVATE KEY")
}

func TestGenerateInvalidType(t *testing.T) {
	_, _, err := ssh.GenerateKeyPair("dsa")
	assert.Error(t, err)
}
```

- [ ] **Step 2: Write keygen implementation**

```go
package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"errors"
	"fmt"

	gossh "golang.org/x/crypto/ssh"
)

func GenerateKeyPair(keyType string) (publicKey []byte, privateKey []byte, err error) {
	switch keyType {
	case "ed25519":
		return generateEd25519()
	case "rsa":
		return generateRSA(4096)
	default:
		return nil, nil, fmt.Errorf("unsupported key type: %s (use ed25519 or rsa)", keyType)
	}
}

func generateEd25519() ([]byte, []byte, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	sshPub, err := gossh.NewPublicKey(pub)
	if err != nil {
		return nil, nil, err
	}
	pubBytes := gossh.MarshalAuthorizedKey(sshPub)

	privBlock, err := gossh.MarshalPrivateKey(priv, "")
	if err != nil {
		return nil, nil, err
	}
	privBytes := pem.EncodeToMemory(privBlock)

	return pubBytes, privBytes, nil
}

func generateRSA(bits int) ([]byte, []byte, error) {
	if bits < 2048 {
		return nil, nil, errors.New("RSA key must be at least 2048 bits")
	}
	key, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return nil, nil, err
	}
	sshPub, err := gossh.NewPublicKey(&key.PublicKey)
	if err != nil {
		return nil, nil, err
	}
	pubBytes := gossh.MarshalAuthorizedKey(sshPub)

	privBlock, err := gossh.MarshalPrivateKey(key, "")
	if err != nil {
		return nil, nil, err
	}
	privBytes := pem.EncodeToMemory(privBlock)

	return pubBytes, privBytes, nil
}
```

- [ ] **Step 3: Write fingerprint test**

```go
package ssh_test

import (
	"testing"

	"github.com/othmanhaba/nixway-core/internal/ssh"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFingerprint(t *testing.T) {
	pub, _, err := ssh.GenerateKeyPair("ed25519")
	require.NoError(t, err)

	fp, err := ssh.Fingerprint(pub)
	require.NoError(t, err)
	assert.True(t, len(fp) > 0)
	assert.Contains(t, fp, "SHA256:")
}
```

- [ ] **Step 4: Write fingerprint implementation**

```go
package ssh

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	gossh "golang.org/x/crypto/ssh"
)

func Fingerprint(publicKey []byte) (string, error) {
	key, _, _, _, err := gossh.ParseAuthorizedKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("parse public key: %w", err)
	}
	hash := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.StdEncoding.EncodeToString(hash[:]), nil
}
```

- [ ] **Step 5: Run tests**

```bash
cd internal && go test ./ssh/ -v
```

- [ ] **Step 6: Commit**

```bash
git add internal/ssh/
git commit -m "feat: add SSH key generation (ed25519/RSA) and fingerprinting"
```

---

## Task 5: SSH Client

**Files:**
- Create: `internal/ssh/client.go`

- [ ] **Step 1: Write SSH client**

```go
package ssh

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type Client struct {
	config *gossh.ClientConfig
	addr   string
}

type ConnectResult struct {
	Uname     string
	DiskSpace string
	HasSudo   bool
	OS        string
	OSVersion string
	Arch      string
}

func NewClient(host string, port int, user string, privateKey []byte) (*Client, error) {
	signer, err := gossh.ParsePrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	config := &gossh.ClientConfig{
		User:            user,
		Auth:            []gossh.AuthMethod{gossh.PublicKeys(signer)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	return &Client{
		config: config,
		addr:   net.JoinHostPort(host, fmt.Sprintf("%d", port)),
	}, nil
}

func (c *Client) RunCommand(ctx context.Context, command string) (string, error) {
	conn, err := gossh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return "", fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		return "", fmt.Errorf("new session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(command); err != nil {
		return "", fmt.Errorf("run %q: %w (stderr: %s)", command, err, stderr.String())
	}
	return stdout.String(), nil
}

func (c *Client) ConnectivityCheck(ctx context.Context) (*ConnectResult, error) {
	result := &ConnectResult{}

	uname, err := c.RunCommand(ctx, "uname -a")
	if err != nil {
		return nil, fmt.Errorf("connectivity check failed: %w", err)
	}
	result.Uname = uname

	disk, err := c.RunCommand(ctx, "df -h /")
	if err == nil {
		result.DiskSpace = disk
	}

	_, err = c.RunCommand(ctx, "sudo -n true")
	result.HasSudo = err == nil

	osRelease, err := c.RunCommand(ctx, "cat /etc/os-release")
	if err == nil {
		result.OS, result.OSVersion = parseOSRelease(osRelease)
	}

	arch, err := c.RunCommand(ctx, "uname -m")
	if err == nil {
		result.Arch = trimNewline(arch)
	}

	return result, nil
}

func (c *Client) PushFile(ctx context.Context, content []byte, remotePath string, mode string) error {
	conn, err := gossh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("new session: %w", err)
	}
	defer session.Close()

	cmd := fmt.Sprintf("cat > %s && chmod %s %s", remotePath, mode, remotePath)
	session.Stdin = bytes.NewReader(content)
	return session.Run(cmd)
}

func parseOSRelease(content string) (string, string) {
	var id, version string
	for _, line := range bytes.Split([]byte(content), []byte("\n")) {
		l := string(line)
		if len(l) > 3 && l[:3] == "ID=" {
			id = trimQuotes(l[3:])
		}
		if len(l) > 11 && l[:11] == "VERSION_ID=" {
			version = trimQuotes(l[11:])
		}
	}
	return id, version
}

func trimQuotes(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}

func trimNewline(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./ssh/
```

- [ ] **Step 3: Commit**

```bash
git add internal/ssh/client.go
git commit -m "feat: add SSH client with connectivity check and file push"
```

---

## Task 6: Config — Add Master Key

**Files:**
- Modify: `internal/config/config.go`

- [ ] **Step 1: Add MasterKey to config**

Add to `Config` struct:
```go
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Auth     AuthConfig
	Email    EmailConfig
	Crypto   CryptoConfig
}

type CryptoConfig struct {
	MasterKey string
}
```

Add to `Load()`:
```go
v.SetDefault("crypto.master_key", "")
// ...
cfg.Crypto.MasterKey = v.GetString("crypto.master_key")
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add internal/config/config.go
git commit -m "feat: add crypto master key to config"
```

---

## Task 7: Provisioning Scripts + Embed

**Files:**
- Create: `internal/provisioner/scripts/docker.sh`, `traefik.sh`, `nixpacks.sh`, `buildpacks.sh`, `railpack.sh`
- Create: `internal/provisioner/embed.go`

- [ ] **Step 1: Write provisioning scripts**

`internal/provisioner/scripts/docker.sh`:
```bash
#!/bin/bash
set -euo pipefail
echo "=== Installing Docker ==="

# Remove old versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install dependencies
apt-get update
apt-get install -y ca-certificates curl gnupg

# Add Docker GPG key and repo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Configure daemon
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DAEMON'
{
  "log-driver": "json-file",
  "log-opts": {"max-size": "10m", "max-file": "3"},
  "storage-driver": "overlay2",
  "live-restore": true
}
DAEMON

systemctl enable docker
systemctl restart docker

echo "=== Docker installed: $(docker --version) ==="
```

`internal/provisioner/scripts/traefik.sh`:
```bash
#!/bin/bash
set -euo pipefail
echo "=== Installing Traefik ==="

mkdir -p /etc/traefik /etc/traefik/dynamic

cat > /etc/traefik/traefik.yml <<'CONFIG'
api:
  dashboard: false
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    directory: "/etc/traefik/dynamic"
    watch: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@nixway.dev
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
CONFIG

docker pull traefik:v3.3
docker rm -f traefik 2>/dev/null || true
docker run -d --name traefik --restart=always \
  -p 80:80 -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/traefik:/etc/traefik \
  traefik:v3.3

echo "=== Traefik installed ==="
```

`internal/provisioner/scripts/nixpacks.sh`:
```bash
#!/bin/bash
set -euo pipefail
echo "=== Installing Nixpacks ==="

ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
esac

curl -fsSL https://nixpacks.com/install.sh | bash

echo "=== Nixpacks installed: $(nixpacks --version) ==="
```

`internal/provisioner/scripts/buildpacks.sh`:
```bash
#!/bin/bash
set -euo pipefail
echo "=== Installing Cloud Native Buildpacks (pack CLI) ==="

ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
esac

PACK_VERSION=$(curl -s https://api.github.com/repos/buildpacks/pack/releases/latest | grep tag_name | cut -d '"' -f 4)
curl -fsSL "https://github.com/buildpacks/pack/releases/download/${PACK_VERSION}/pack-${PACK_VERSION}-linux-${ARCH}.tgz" | tar xz -C /usr/local/bin

pack config default-builder heroku/builder:24

echo "=== Pack CLI installed: $(pack --version) ==="
```

`internal/provisioner/scripts/railpack.sh`:
```bash
#!/bin/bash
set -euo pipefail
echo "=== Installing Railpack ==="

curl -fsSL https://railpack.com/install.sh | bash

echo "=== Railpack installed: $(railpack --version) ==="
```

- [ ] **Step 2: Write embed.go**

`internal/provisioner/embed.go`:
```go
package provisioner

import "embed"

//go:embed scripts/*.sh
var Scripts embed.FS

func GetScript(component string) ([]byte, error) {
	return Scripts.ReadFile("scripts/" + component + ".sh")
}

var AvailableComponents = []string{"docker", "traefik", "nixpacks", "buildpacks", "railpack"}

func IsValidComponent(name string) bool {
	for _, c := range AvailableComponents {
		if c == name {
			return true
		}
	}
	return false
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd internal && go build ./provisioner/
```

- [ ] **Step 4: Commit**

```bash
git add internal/provisioner/
git commit -m "feat: add provisioning scripts with Go embed"
```

---

## Task 8: Auto-Discovery Engine

**Files:**
- Create: `internal/discovery/discovery.go`, `internal/discovery/discovery_test.go`

- [ ] **Step 1: Write test**

```go
package discovery_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/discovery"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDiscoverDockerfile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte("FROM node:18"), 0644)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0644)

	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	require.NotEmpty(t, results)
	assert.Equal(t, "docker", results[0].Builder)
}

func TestDiscoverNixpacks(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "nixpacks.toml"), []byte("[phases]"), 0644)

	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	assert.Equal(t, "nixpacks", results[0].Builder)
}

func TestDiscoverNodeFallback(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"app"}`), 0644)

	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	assert.Equal(t, "nixpacks", results[0].Builder)
	assert.Contains(t, results[0].Reason, "package.json")
}

func TestDiscoverGo(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module test"), 0644)

	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	assert.Equal(t, "nixpacks", results[0].Builder)
	assert.Contains(t, results[0].Reason, "go.mod")
}

func TestDiscoverPython(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "requirements.txt"), []byte("flask"), 0644)

	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	assert.Equal(t, "nixpacks", results[0].Builder)
}

func TestDiscoverRust(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "Cargo.toml"), []byte("[package]"), 0644)

	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	assert.Equal(t, "nixpacks", results[0].Builder)
	assert.Contains(t, results[0].Reason, "Cargo.toml")
}

func TestDiscoverEmpty(t *testing.T) {
	dir := t.TempDir()
	results, err := discovery.Discover(dir)
	require.NoError(t, err)
	assert.Empty(t, results)
}
```

- [ ] **Step 2: Write implementation**

```go
package discovery

import (
	"os"
	"path/filepath"
)

type BuilderCandidate struct {
	Builder    string  `json:"builder"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

func Discover(repoPath string) ([]BuilderCandidate, error) {
	var candidates []BuilderCandidate

	if fileExists(repoPath, "Dockerfile") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "docker", Confidence: 1.0, Reason: "Dockerfile found at root",
		})
	}

	if fileExists(repoPath, "nixpacks.toml") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.95, Reason: "nixpacks.toml found",
		})
	}

	hasProcfile := fileExists(repoPath, "Procfile")
	if hasProcfile {
		candidates = append(candidates, BuilderCandidate{
			Builder: "buildpacks", Confidence: 0.85, Reason: "Procfile found",
		})
	}

	// Language detection fallbacks
	if fileExists(repoPath, "package.json") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Node.js detected (package.json)",
		})
	}
	if fileExists(repoPath, "requirements.txt") || fileExists(repoPath, "pyproject.toml") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Python detected (requirements.txt/pyproject.toml)",
		})
	}
	if fileExists(repoPath, "go.mod") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Go detected (go.mod)",
		})
	}
	if fileExists(repoPath, "Cargo.toml") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Rust detected (Cargo.toml)",
		})
	}
	if fileExists(repoPath, "Gemfile") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "buildpacks", Confidence: 0.7, Reason: "Ruby detected (Gemfile)",
		})
	}

	// Deduplicate: keep highest confidence per builder
	seen := make(map[string]int)
	var deduped []BuilderCandidate
	for _, c := range candidates {
		if idx, ok := seen[c.Builder]; ok {
			if c.Confidence > deduped[idx].Confidence {
				deduped[idx] = c
			}
		} else {
			seen[c.Builder] = len(deduped)
			deduped = append(deduped, c)
		}
	}

	return deduped, nil
}

func fileExists(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}
```

- [ ] **Step 3: Run tests**

```bash
cd internal && go test ./discovery/ -v
```

- [ ] **Step 4: Commit**

```bash
git add internal/discovery/
git commit -m "feat: add auto-discovery engine for builder detection"
```

---

## Task 9: Extend Agent Protocol

**Files:**
- Modify: `proto/agent/v1/agent.proto`
- Regenerate: `internal/agent/proto/agent/v1/*.pb.go`

- [ ] **Step 1: Update proto file**

Add new messages and extend oneofs in `proto/agent/v1/agent.proto`:

Add after `DiskInfo`:
```protobuf
message NetworkInterface {
  string name = 1;
  repeated string ips = 2;
}

message ResourceReport {
  string agent_id = 1;
  string cpu_model = 2;
  int32 cpu_cores = 3;
  uint64 memory_total = 4;
  uint64 memory_available = 5;
  string kernel_version = 6;
  string docker_version = 7;
  repeated DiskInfo disks = 8;
  repeated NetworkInterface network_interfaces = 9;
}

message ProvisionCommand {
  string job_id = 1;
  string component = 2;
  bytes script = 3;
}

message ProvisionOutput {
  string job_id = 1;
  string component = 2;
  bytes output = 3;
  bool finished = 4;
  bool success = 5;
  string error = 6;
}

message SSHKeyInstallCommand {
  string action = 1;
  string public_key = 2;
}

message SSHKeyInstallResult {
  bool success = 1;
  string error = 2;
}
```

Update `AgentMessage` oneof to add:
```protobuf
ResourceReport resource_report = 5;
ProvisionOutput provision_output = 6;
SSHKeyInstallResult ssh_key_result = 7;
```

Update `ControlMessage` oneof to add:
```protobuf
ProvisionCommand provision_command = 4;
SSHKeyInstallCommand ssh_key_install = 5;
```

- [ ] **Step 2: Regenerate Go code**

```bash
cd proto && protoc --go_out=../internal/agent/proto --go_opt=paths=source_relative \
  --go-grpc_out=../internal/agent/proto --go-grpc_opt=paths=source_relative \
  -I. -I/opt/homebrew/include \
  agent/v1/agent.proto
```

- [ ] **Step 3: Verify it compiles**

```bash
cd internal && go build ./agent/...
```

- [ ] **Step 4: Commit**

```bash
git add proto/ internal/agent/proto/
git commit -m "feat: extend agent protocol with resource reports and provisioning"
```

---

## Task 10: Agent — Resource Collection + Provisioning Execution

**Files:**
- Create: `apps/agent/resources.go`, `apps/agent/provision.go`
- Modify: `apps/agent/heartbeat.go`, `apps/agent/main.go`

- [ ] **Step 1: Write resource collector**

`apps/agent/resources.go` — collects CPU, RAM, disk, network, kernel, Docker version from the local system using `/proc`, `syscall`, `net`, and exec commands.

- [ ] **Step 2: Write provision executor**

`apps/agent/provision.go` — receives ProvisionCommand, writes script to temp file, executes it with bash, streams stdout/stderr back as ProvisionOutput messages.

- [ ] **Step 3: Update heartbeat to send ResourceReport**

Modify `apps/agent/heartbeat.go` to send `ResourceReport` instead of simple `Heartbeat` on each tick.

- [ ] **Step 4: Update main.go to handle new control messages**

Add cases for `ProvisionCommand` and `SSHKeyInstallCommand` in the message receive loop.

- [ ] **Step 5: Verify agent compiles and cross-compiles**

```bash
cd apps/agent && go build .
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o bin/agent-linux-amd64 .
```

- [ ] **Step 6: Commit**

```bash
git add apps/agent/
git commit -m "feat: add resource collection and provisioning execution to agent"
```

---

## Task 11: Server Status Watcher

**Files:**
- Create: `internal/server/status.go`

- [ ] **Step 1: Write status watcher**

```go
package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/othmanhaba/nixway-core/internal/db"
)

type StatusWatcher struct {
	queries *db.Queries
	logger  *slog.Logger
}

func NewStatusWatcher(queries *db.Queries, logger *slog.Logger) *StatusWatcher {
	return &StatusWatcher{queries: queries, logger: logger}
}

func (w *StatusWatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.check(ctx)
		}
	}
}

func (w *StatusWatcher) check(ctx context.Context) {
	servers, err := w.queries.ListServersNeedingStatusUpdate(ctx)
	if err != nil {
		w.logger.Error("status watcher query failed", "error", err)
		return
	}

	now := time.Now()
	for _, s := range servers {
		if !s.LastSeenAt.Valid {
			continue
		}
		elapsed := now.Sub(s.LastSeenAt.Time)
		var newStatus string

		switch {
		case elapsed < 20*time.Second:
			newStatus = "online"
		case elapsed < 50*time.Second:
			newStatus = "degraded"
		default:
			newStatus = "offline"
		}

		if newStatus != s.Status {
			w.logger.Info("server status changed",
				"server_id", s.ID,
				"old_status", s.Status,
				"new_status", newStatus,
				"last_seen", elapsed.String(),
			)
			_ = w.queries.UpdateServerStatus(ctx, db.UpdateServerStatusParams{
				ID:         s.ID,
				Status:     newStatus,
				LastSeenAt: s.LastSeenAt,
			})
		}
	}
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./server/
```

- [ ] **Step 3: Commit**

```bash
git add internal/server/
git commit -m "feat: add server status watcher with heartbeat-driven transitions"
```

---

## Task 12: Server Onboarding Orchestrator

**Files:**
- Create: `internal/server/onboarding.go`

- [ ] **Step 1: Write onboarding orchestrator**

The orchestrator handles the full server add flow:
1. Decrypt SSH private key using crypto.Decrypt
2. Create SSH client
3. Run connectivity check
4. Validate OS (ubuntu 22.04/24.04, debian 12)
5. Create server record in DB
6. Attach SSH key to server
7. Generate enrollment token
8. Generate installer script with embedded token + control plane URL
9. Push installer script to server via SSH
10. Execute installer script
11. Wait for agent registration (poll ConnManager)

```go
package server

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	internalSSH "github.com/othmanhaba/nixway-core/internal/ssh"
)

type OnboardingService struct {
	queries   *db.Queries
	logger    *slog.Logger
	masterKey [32]byte
	apiURL    string
}

func NewOnboardingService(queries *db.Queries, logger *slog.Logger, masterKey [32]byte, apiURL string) *OnboardingService {
	return &OnboardingService{queries: queries, logger: logger, masterKey: masterKey, apiURL: apiURL}
}

type OnboardRequest struct {
	TeamID   uuid.UUID
	Name     string
	Hostname string
	PublicIP string
	SSHPort  int
	SSHUser  string
	SSHKeyID uuid.UUID
}

type OnboardResult struct {
	ServerID  uuid.UUID
	OS        string
	OSVersion string
	Arch      string
}

var supportedOS = map[string][]string{
	"ubuntu": {"22.04", "24.04"},
	"debian": {"12"},
}

func (s *OnboardingService) Onboard(ctx context.Context, req OnboardRequest) (*OnboardResult, error) {
	// 1. Get and decrypt SSH key
	sshKey, err := s.queries.GetSSHKeyByID(ctx, db.GetSSHKeyByIDParams{
		ID: req.SSHKeyID, TeamID: req.TeamID,
	})
	if err != nil {
		return nil, fmt.Errorf("get ssh key: %w", err)
	}

	privateKey, err := crypto.Decrypt(sshKey.PrivateKeyEncrypted, s.masterKey, req.TeamID.String())
	if err != nil {
		return nil, fmt.Errorf("decrypt ssh key: %w", err)
	}

	// 2. SSH connectivity check
	client, err := internalSSH.NewClient(req.Hostname, req.SSHPort, req.SSHUser, privateKey)
	if err != nil {
		return nil, fmt.Errorf("create ssh client: %w", err)
	}

	check, err := client.ConnectivityCheck(ctx)
	if err != nil {
		return nil, fmt.Errorf("connectivity check: %w", err)
	}

	// 3. Validate OS
	if !isOSSupported(check.OS, check.OSVersion) {
		return nil, fmt.Errorf("unsupported OS: %s %s (supported: Ubuntu 22.04/24.04, Debian 12)", check.OS, check.OSVersion)
	}

	if !check.HasSudo {
		return nil, fmt.Errorf("passwordless sudo required but not available")
	}

	// 4. Create server record
	server, err := s.queries.CreateServer(ctx, db.CreateServerParams{
		TeamID:   req.TeamID,
		Name:     req.Name,
		Hostname: req.Hostname,
		PublicIp: req.PublicIP, // adapt to actual sqlc type
		SshPort:  int32(req.SSHPort),
		SshUser:  req.SSHUser,
		Os:       &check.OS,
		OsVersion: &check.OSVersion,
		Arch:     &check.Arch,
		Status:   "provisioning",
	})
	if err != nil {
		return nil, fmt.Errorf("create server: %w", err)
	}

	// 5. Attach SSH key
	_ = s.queries.AttachSSHKeyToServer(ctx, db.AttachSSHKeyToServerParams{
		ServerID: server.ID, SshKeyID: req.SSHKeyID,
	})

	// 6. Generate and push installer script
	enrollToken := uuid.New().String()
	script := generateInstallerScript(s.apiURL, enrollToken, server.ID.String())

	if err := client.PushFile(ctx, []byte(script), "/tmp/nixway-install.sh", "0755"); err != nil {
		return nil, fmt.Errorf("push installer: %w", err)
	}

	// 7. Execute installer
	output, err := client.RunCommand(ctx, "sudo bash /tmp/nixway-install.sh")
	if err != nil {
		s.logger.Error("installer failed", "output", output, "error", err)
		return nil, fmt.Errorf("installer failed: %w", err)
	}

	return &OnboardResult{
		ServerID: server.ID, OS: check.OS, OSVersion: check.OSVersion, Arch: check.Arch,
	}, nil
}

func isOSSupported(os, version string) bool {
	versions, ok := supportedOS[strings.ToLower(os)]
	if !ok {
		return false
	}
	for _, v := range versions {
		if v == version {
			return true
		}
	}
	return false
}

func generateInstallerScript(apiURL, enrollToken, serverID string) string {
	return fmt.Sprintf(`#!/bin/bash
set -euo pipefail

ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
esac

echo "Downloading nixway agent for $ARCH..."
curl -fsSL "%s/agent/download/$ARCH" -o /usr/local/bin/nixway-agent
chmod +x /usr/local/bin/nixway-agent

cat > /etc/systemd/system/nixway-agent.service <<'EOF'
[Unit]
Description=Nixway Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/nixway-agent --server %s --id %s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nixway-agent
systemctl start nixway-agent

echo "Nixway agent installed and started."
`, apiURL, apiURL, serverID)
}
```

Note: The `CreateServerParams` fields need to match the actual sqlc-generated types (particularly for INET, nullable strings). Adapt at implementation time.

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./server/
```

- [ ] **Step 3: Commit**

```bash
git add internal/server/onboarding.go
git commit -m "feat: add server onboarding orchestrator with SSH setup and agent install"
```

---

## Task 13: API Handlers — SSH Keys

**Files:**
- Create: `internal/api/handler/sshkey.go`

- [ ] **Step 1: Write SSH key handler**

SSHKeyHandler with CRUD methods:
- `Create`: generate or upload key, encrypt private key, store, return public info
- `List`: list keys for team (no private key data)
- `Get`: get single key detail
- `Delete`: delete key
- `Rotate`: generate new key, push to all attached servers via agent

Follow the existing handler pattern (struct with queries, audit, logger, config dependencies).

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./api/handler/
```

- [ ] **Step 3: Commit**

```bash
git add internal/api/handler/sshkey.go
git commit -m "feat: add SSH key CRUD handlers"
```

---

## Task 14: API Handlers — Servers, Tags, Provisioning, Discovery

**Files:**
- Create: `internal/api/handler/server_handler.go`, `internal/api/handler/tag.go`, `internal/api/handler/provision.go`, `internal/api/handler/discover.go`

- [ ] **Step 1: Write server handler**

ServerHandler: Create (triggers onboarding), List (with tag filter), Get (with resources), Update, Delete

- [ ] **Step 2: Write tag handler**

TagHandler: List, Set, Delete

- [ ] **Step 3: Write provisioning handler with SSE**

ProvisionHandler:
- `Start`: create provisioning job, push scripts to agent
- `Status`: get latest job status + logs
- `StreamLogs`: SSE endpoint — subscribes to Redis pub/sub channel `provision:<job_id>`, streams events to client with `Content-Type: text/event-stream`
- `Retry`: retry failed job

SSE implementation:
```go
func (h *ProvisionHandler) StreamLogs(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        respond.Error(w, http.StatusInternalServerError, "streaming not supported")
        return
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")

    // Subscribe to Redis pub/sub channel
    jobID := r.PathValue("jobId") // or derive from server's latest job
    sub := h.redis.Subscribe(r.Context(), "provision:"+jobID)
    defer sub.Close()
    ch := sub.Channel()

    for {
        select {
        case <-r.Context().Done():
            return
        case msg := <-ch:
            fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
            flusher.Flush()
        }
    }
}
```

- [ ] **Step 4: Write discovery handler**

DiscoveryHandler: accepts repo path, runs `discovery.Discover()`, returns results

- [ ] **Step 5: Verify all compile**

```bash
cd internal && go build ./api/handler/
```

- [ ] **Step 6: Commit**

```bash
git add internal/api/handler/server_handler.go internal/api/handler/tag.go internal/api/handler/provision.go internal/api/handler/discover.go
git commit -m "feat: add server, tag, provisioning (with SSE), and discovery handlers"
```

---

## Task 15: Router + Wiring

**Files:**
- Modify: `internal/api/router.go`
- Modify: `apps/api/main.go`

- [ ] **Step 1: Register new routes in router.go**

Add to the protected mux:
```go
// SSH Keys
protected.HandleFunc("POST /api/v1/teams/{id}/ssh-keys", sshKeyH.Create)
protected.HandleFunc("GET /api/v1/teams/{id}/ssh-keys", sshKeyH.List)
protected.HandleFunc("GET /api/v1/teams/{id}/ssh-keys/{keyId}", sshKeyH.Get)
protected.HandleFunc("DELETE /api/v1/teams/{id}/ssh-keys/{keyId}", sshKeyH.Delete)

// Servers
protected.HandleFunc("POST /api/v1/teams/{id}/servers", serverH.Create)
protected.HandleFunc("GET /api/v1/teams/{id}/servers", serverH.List)
protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}", serverH.Get)
protected.HandleFunc("PUT /api/v1/teams/{id}/servers/{serverId}", serverH.Update)
protected.HandleFunc("DELETE /api/v1/teams/{id}/servers/{serverId}", serverH.Delete)

// Tags
protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/tags", tagH.List)
protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/tags", tagH.Set)
protected.HandleFunc("DELETE /api/v1/teams/{id}/servers/{serverId}/tags/{key}", tagH.Delete)

// Provisioning
protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/provision", provisionH.Start)
protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/provision", provisionH.Status)
protected.HandleFunc("GET /api/v1/teams/{id}/servers/{serverId}/provision/logs/stream", provisionH.StreamLogs)
protected.HandleFunc("POST /api/v1/teams/{id}/servers/{serverId}/provision/retry", provisionH.Retry)

// Discovery
protected.HandleFunc("POST /api/v1/auto-discover", discoverH.Discover)
```

Update `NewRouter` signature to accept additional dependencies (Redis client for SSE pub/sub, crypto master key, onboarding service).

- [ ] **Step 2: Wire in apps/api/main.go**

Add master key loading from config, pass Redis client and onboarding service to router.
Start status watcher goroutine.

- [ ] **Step 3: Verify it compiles**

```bash
cd internal && go build ./...
cd apps/api && go build .
```

- [ ] **Step 4: Commit**

```bash
git add internal/api/router.go apps/api/main.go
git commit -m "feat: register Phase 1 routes and wire dependencies"
```

---

## Task 16: Update Agent Server (Control Plane Side)

**Files:**
- Modify: `internal/agent/server.go`
- Modify: `internal/agent/connmanager.go`

- [ ] **Step 1: Extend ConnManager with resource data**

Add resource fields to `ConnState` and a method to update them from a ResourceReport.

- [ ] **Step 2: Update server.go to handle new message types**

Add cases in the `Connect()` method for:
- `ResourceReport` — update ConnManager with resource data, upsert `server_resources` in DB, update `last_seen_at`
- `ProvisionOutput` — publish to Redis pub/sub channel `provision:<job_id>`, append to `provisioning_jobs.logs`
- `SSHKeyInstallResult` — log result

The server needs access to `*db.Queries` and `*redis.Client` now. Update `NewServer` signature.

- [ ] **Step 3: Verify it compiles**

```bash
cd internal && go build ./agent/
```

- [ ] **Step 4: Commit**

```bash
git add internal/agent/server.go internal/agent/connmanager.go
git commit -m "feat: handle resource reports and provisioning output in agent server"
```

---

## Task 17: Web UI — Server Management Pages

**Files:**
- Create: `apps/web/src/routes/_app/teams/$teamId/servers/index.tsx`
- Create: `apps/web/src/routes/_app/teams/$teamId/servers/$serverId.tsx`
- Create: `apps/web/src/routes/_app/teams/$teamId/ssh-keys.tsx`
- Create: `apps/web/src/hooks/use-sse.ts`
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Add types**

Add to `types.ts`: Server, SSHKey, ServerTag, ServerResources, ProvisioningJob, BuilderCandidate

- [ ] **Step 2: Create SSE hook**

`src/hooks/use-sse.ts`:
```typescript
import { useEffect, useState, useRef } from 'react'

export function useSSE(url: string | null) {
  const [messages, setMessages] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!url) return

    const source = new EventSource(url)
    sourceRef.current = source
    setConnected(true)

    source.onmessage = (event) => {
      setMessages(prev => [...prev, event.data])
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
    }

    return () => {
      source.close()
      setConnected(false)
    }
  }, [url])

  return { messages, connected }
}
```

- [ ] **Step 3: Build server list page**

TanStack Table with status badges, tags, "Add Server" wizard dialog.

- [ ] **Step 4: Build server detail page**

Tabs: Overview, Resources, Provisioning (with SSE log stream), Tags.

- [ ] **Step 5: Build SSH keys page**

Key list, generate/upload dialogs, delete confirmation.

- [ ] **Step 6: Add nav links**

Update app layout to include "Servers" and "SSH Keys" links.

- [ ] **Step 7: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/
git commit -m "feat: add server management, SSH keys, and provisioning UI pages"
```

---

## Task 18: Integration Tests

**Files:**
- Create: `tests/integration/server_test.go`
- Create: `tests/integration/discovery_test.go`

- [ ] **Step 1: Write server management integration tests**

Test the full flow via API:
1. Create SSH key → verify listed
2. Add server (with mocked SSH — or test just the API layer)
3. Verify server record created
4. Set tags → list → filter by tag
5. Start provisioning → verify job created
6. Delete server → verify cleanup

- [ ] **Step 2: Write discovery integration test**

Test auto-discovery endpoint with sample repo paths.

- [ ] **Step 3: Write heartbeat status transition test**

Test status watcher: create server, set last_seen_at to old time, run watcher check, verify status transitions.

- [ ] **Step 4: Run all tests**

```bash
cd tests && go test -v ./integration/ -count=1 -timeout 5m
```

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add server management integration tests"
```

---

## Task 19: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd internal && go test ./... -count=1
cd tests && go test -v ./integration/ -count=1 -timeout 5m
cd apps/web && pnpm build
```

- [ ] **Step 2: Build all apps**

```bash
go build ./apps/api && go build ./apps/worker && go build ./apps/agent && go build ./apps/cli
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: complete Phase 1 Server Management — all components built and verified"
```

---

## Exit Criteria Checklist

| # | Criterion | Test |
|---|-----------|------|
| 1 | User adds server, agent installs and reports online within 2 minutes | `server_test.go` |
| 2 | User selects components, provisioning completes with logs in UI | `server_test.go` + manual UI |
| 3 | Resource metrics update on heartbeat | `server_test.go` |
| 4 | Auto-discovery correctly identifies builder for 5 sample repos | `discovery_test.go` + unit tests |
| 5 | Server reboot: agent reconnects, state restored | Agent reconnect (Phase 0 tested) |
| 6 | SSH key rotation: old key removed, new key works | `server_test.go` |
| 7 | Removing server: deregisters, offers cleanup | `server_test.go` |
| 8 | Tagging server with env=prod visible and filterable | `server_test.go` |
