/* Full-width architecture section. ASCII-diagram as <pre>, matches the
   mono aesthetic of the console. Replaces the AI-default "three boxes
   with arrows" feature row. */

export function Architecture() {
  return (
    <section className="border-b border-line-1 bg-surface-0 relative">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-[1.05]">
            Two binaries. One overlay. Your servers.
          </h2>
          <p className="mt-4 text-ink-2 text-[15px] leading-relaxed">
            The control plane runs anywhere a Postgres lives. The agent runs on
            every server you want to ship to. They talk over a reverse SSH
            tunnel, so the agent never needs a public port. The data plane
            stays inside your VPC.
          </p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-line-1 bg-surface-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              topology
            </span>
            <span className="flex-1 h-px bg-line-1" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              one VPC, three regions
            </span>
          </div>
          <pre className="font-mono text-[12px] sm:text-[13px] leading-[1.6] text-ink-2 px-6 py-7 overflow-x-auto">
{`            ┌──────────────────────────────────────────┐
            │       NIXWAY CORE  ·  control plane      │
            │   API · Worker · Postgres · Redis · S3   │
            └────────┬─────────────────┬───────────────┘
                     │ reverse SSH     │ HTTPS (TLS)
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
   │  ── apps             │    │  ── apps                │
   │  ── postgres replica │    │  ── postgres replica    │
   └──────────────────────┘    └─────────────────────────┘`}
          </pre>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-[13px]">
          <Note title="Control plane" body="Stateless API + worker, backed by Postgres. Self-host it on a single $20 box or behind your existing load balancer." />
          <Note title="Data plane" body="Agents run your workloads. The control plane never holds your data and never sees your traffic." />
          <Note title="Egress" body="Outbound only. The agent dials the control plane over reverse SSH, so you never open a port to the public internet." />
        </div>
      </div>
    </section>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-t border-line-1 pt-5">
      <div className="text-ink-1 text-[13px] font-medium mb-1">{title}</div>
      <p className="text-ink-3 text-[12.5px] leading-relaxed">{body}</p>
    </div>
  );
}
