import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Self-host the control plane · Docs" };

export default function SelfHostDoc() {
  return (
    <DocPage
      eyebrow="Docs · guide"
      title="Self-host the control plane"
      lede="Run the whole platform on one Docker Compose file. Suitable for home labs, single-region production, and air-gapped enterprise."
      prev={{ href: "/docs/guides/aws-quickstart", label: "AWS quickstart" }}
      next={{ href: "/docs/cli", label: "CLI reference" }}
    >
      <h2>What gets installed</h2>
      <ul>
        <li><strong>API</strong> HTTP &amp; gRPC server</li>
        <li><strong>Worker</strong> background job runner</li>
        <li><strong>Postgres</strong> platform state</li>
        <li><strong>Redis</strong> queue + cache</li>
        <li><strong>MinIO</strong> build artifacts &amp; backups (or bring an S3 bucket)</li>
        <li><strong>VictoriaMetrics</strong> + <strong>vmagent</strong> metrics pipeline</li>
        <li><strong>Console</strong> the Next.js operator UI</li>
        <li><strong>Traefik</strong> reverse proxy and ACME</li>
      </ul>

      <h2>Hardware</h2>
      <p>
        For up to 25 servers and 100 apps, one <code>4 vCPU / 8 GB</code> box
        is enough. For anything larger, scale Postgres vertically before the
        API. Redis is rarely the bottleneck.
      </p>

      <h2>One-shot install</h2>
      <pre><code>{`# on a fresh Ubuntu 24.04 box with docker installed
curl -fsSL https://nixway.dev/install.sh | sudo bash -

# the installer:
#   - clones the repo
#   - generates a master key for secret encryption
#   - issues an initial TLS cert via Let's Encrypt
#   - boots the whole stack via docker compose
#   - prints the bootstrap URL`}</code></pre>

      <h2>Manual install</h2>
      <pre><code>{`git clone https://github.com/nixway/core
cd core
cp .env.example .env

# generate a master key (saved into .env)
./scripts/keygen >> .env

# bring everything up
docker compose --profile traefik up -d

# tail the API until it's healthy
docker compose logs -f api`}</code></pre>

      <h2>Configuration surface</h2>
      <p>
        The full configuration lives in environment variables, prefixed with{" "}
        <code>NIXWAY_</code>. The most commonly customized variables:
      </p>
      <table className="w-full text-[13px] my-6">
        <thead>
          <tr className="border-b border-line-1">
            <th className="text-left py-2 text-ink-3 font-mono uppercase tracking-[0.14em] text-[10px]">Variable</th>
            <th className="text-left py-2 text-ink-3 font-mono uppercase tracking-[0.14em] text-[10px]">Default</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-1">
          <tr><td className="py-2 text-ink-1 font-mono text-[12px]">NIXWAY_PUBLIC_DOMAIN</td><td className="py-2 text-ink-2">localhost</td></tr>
          <tr><td className="py-2 text-ink-1 font-mono text-[12px]">NIXWAY_DATABASE_URL</td><td className="py-2 text-ink-2">postgres://nixway:****@postgres:5432/nixway_core</td></tr>
          <tr><td className="py-2 text-ink-1 font-mono text-[12px]">NIXWAY_REDIS_URL</td><td className="py-2 text-ink-2">redis://redis:6379/0</td></tr>
          <tr><td className="py-2 text-ink-1 font-mono text-[12px]">NIXWAY_CRYPTO_MASTER_KEY</td><td className="py-2 text-ink-2">required, 32 bytes base64</td></tr>
          <tr><td className="py-2 text-ink-1 font-mono text-[12px]">NIXWAY_PLATFORMSTORAGE_PROVIDER</td><td className="py-2 text-ink-2">minio · s3 · gcs</td></tr>
          <tr><td className="py-2 text-ink-1 font-mono text-[12px]">NIXWAY_EMAIL_DRIVER</td><td className="py-2 text-ink-2">console · ses · smtp</td></tr>
        </tbody>
      </table>

      <h2>First-run bootstrap</h2>
      <ol>
        <li>Open <code>https://your-domain.dev</code> in a browser.</li>
        <li>Create the first user. This account becomes Owner of the bootstrap team.</li>
        <li>Add an SSH key in <strong>Settings</strong>.</li>
        <li>Register your first server from <strong>Infrastructure → Servers</strong>.</li>
      </ol>

      <h2>Upgrades</h2>
      <p>
        Tag releases pin to a quarter. Bumping is a <code>git pull</code> and a{" "}
        <code>docker compose up -d</code>. Migrations run automatically and
        the API is forward-compatible with the previous minor; agents continue
        operating during the upgrade window.
      </p>

      <h2>Air-gapped install</h2>
      <p>
        Enterprise customers run Nixway in offline environments. The full
        image bundle is published as a single OCI artifact you can
        <code>docker save</code>, mirror, and load. The bootstrap script
        supports an <code>--offline</code> flag. See the enterprise runbook
        included with your contract.
      </p>
    </DocPage>
  );
}
