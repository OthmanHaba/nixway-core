import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Architecture · Docs" };

export default function Architecture() {
  return (
    <DocPage
      eyebrow="Docs · architecture"
      title="Architecture"
      lede="Two binaries, one overlay network, your servers. The control plane never holds your data and never sees your traffic."
      prev={{ href: "/docs/getting-started", label: "Getting started" }}
      next={{ href: "/docs/concepts/projects", label: "Projects & apps" }}
    >
      <h2>Topology</h2>
      <pre><code>{`            ┌──────────────────────────────────────────┐
            │       NIXWAY CORE  ·  control plane      │
            │   API · Worker · Postgres · Redis · S3   │
            └────────┬─────────────────┬───────────────┘
                     │ reverse SSH     │ HTTPS
                     │ (mTLS gRPC)     │
   ┌─────────────────┴────┐    ┌───────┴───────────────────┐
   │  agent · us-east-1   │    │  console · operator UI    │
   │  ── apps             │    │  console.your-domain.dev  │
   │  ── databases        │    └───────────────────────────┘
   │  ── volumes          │
   └─────────┬────────────┘
             │  private mesh (WireGuard-style overlay)
   ┌─────────┴────────────┐    ┌─────────────────────────┐
   │  agent · fra-1       │────│  agent · sgp-1          │
   └──────────────────────┘    └─────────────────────────┘`}</code></pre>

      <h2>Control plane</h2>
      <p>
        The control plane is a Go service that exposes an HTTP API and a gRPC
        endpoint for agents. It is backed by Postgres for durable state and
        Redis for job queues, pub/sub, and short-lived caches.
      </p>
      <ul>
        <li><strong>API</strong> serves the console, the CLI, and partner integrations like GitHub.</li>
        <li><strong>Worker</strong> consumes jobs: builds, rollouts, backups, scheduled tasks.</li>
        <li><strong>Postgres</strong> holds platform state: teams, projects, releases, audit, etc.</li>
        <li><strong>Redis</strong> holds queue state, transient session cache, and rate-limit counters.</li>
        <li><strong>Object storage</strong> (S3 or MinIO) holds build artifacts and backups.</li>
      </ul>

      <h2>Data plane</h2>
      <p>
        Every server you register runs the <strong>agent</strong>: a small Go
        binary that supervises containers, reports health, applies routing,
        and streams logs. The agent never holds platform state; it acts on
        instructions from the control plane and reports back.
      </p>

      <h2>Control-to-agent transport</h2>
      <p>
        The agent dials the control plane over <strong>reverse SSH</strong>,
        carrying an mTLS gRPC channel inside the tunnel. This has two
        consequences worth understanding:
      </p>
      <ul>
        <li>You never open an inbound port on your servers for Nixway.</li>
        <li>The agent works equally well on home labs, dedicated boxes, and cloud VPCs without firewall changes.</li>
      </ul>

      <h2>Private mesh</h2>
      <p>
        Services running on different servers (even in different clouds) talk
        over a private overlay built from agent-to-agent connections. Internal
        DNS resolves <code>app-name.internal</code> to the correct backend
        regardless of geography. Traffic stays encrypted end-to-end and never
        traverses Nixway infrastructure.
      </p>

      <h2>Public routing</h2>
      <p>
        Inbound traffic terminates at the edge agent on each cluster. Traefik
        (bundled with the agent) handles TLS via Let&rsquo;s Encrypt by
        default, with overrides for custom ACME providers or bring-your-own
        wildcard certs.
      </p>

      <h2>What lives where</h2>
      <table className="w-full text-[13px] my-6">
        <thead>
          <tr className="border-b border-line-1">
            <th className="text-left py-2 text-ink-3 font-mono uppercase tracking-[0.14em] text-[10px]">
              Concern
            </th>
            <th className="text-left py-2 text-ink-3 font-mono uppercase tracking-[0.14em] text-[10px]">
              Lives in
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-1">
          <tr><td className="py-2 text-ink-1">Source code</td><td className="py-2 text-ink-2">Your Git host (GitHub, GitLab, self-hosted)</td></tr>
          <tr><td className="py-2 text-ink-1">Build artifacts</td><td className="py-2 text-ink-2">Per-team internal registry (object storage)</td></tr>
          <tr><td className="py-2 text-ink-1">Runtime containers</td><td className="py-2 text-ink-2">Your servers (data plane only)</td></tr>
          <tr><td className="py-2 text-ink-1">Customer traffic</td><td className="py-2 text-ink-2">Your servers · never proxies through Nixway</td></tr>
          <tr><td className="py-2 text-ink-1">Secrets</td><td className="py-2 text-ink-2">Control plane (encrypted) · agent (memory only)</td></tr>
        </tbody>
      </table>
    </DocPage>
  );
}
