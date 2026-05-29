import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Nixway handles authentication, data at rest, data in flight, secrets, and incident response.",
};

const SECTIONS = [
  {
    h: "Identity and access",
    items: [
      ["Sessions", "Bcrypt-hashed passwords (cost 12) and rolling 60-day sessions. SSO for Google and GitHub on the Team tier; SAML and SCIM on Enterprise."],
      ["RBAC", "Three built-in roles: Owner, Admin, Member. Fine-grained per-resource scopes are on the roadmap and tracked in the changelog."],
      ["API tokens", "Scoped, revocable, audited. CI tokens are first-class and never count against your seat license."],
    ],
  },
  {
    h: "Data in flight",
    items: [
      ["TLS everywhere", "Public endpoints terminate TLS at Traefik with Let's Encrypt by default. Bring your own ACME provider or wildcard certificate."],
      ["Control plane to agent", "Reverse SSH tunnel from agent to control plane carries mTLS gRPC. The agent never opens a public port."],
      ["Service mesh", "Inter-service traffic between regions rides a WireGuard-style overlay. End-to-end encrypted, no plaintext on the wire."],
    ],
  },
  {
    h: "Data at rest",
    items: [
      ["Postgres", "Platform state is encrypted at rest with provider-managed keys on hosted; with your KMS on Enterprise."],
      ["Secrets", "Per-team master key derives per-secret data keys. Reveal-once UX in the console; never logged, never written to disk in plaintext."],
      ["Backups", "Daily automated backups to S3-compatible storage. Bring your own bucket on Enterprise."],
    ],
  },
  {
    h: "Audit and incident response",
    items: [
      ["Audit log", "Append-only log of every action, attributable to a user, an API token, or an agent. Exportable as JSON."],
      ["Status", "Live platform status at status.nixway.dev. Post-mortems for any incident over 15 minutes within 5 business days."],
      ["Disclosure", "Coordinated disclosure via security@nixway.dev. We publish a security advisory feed and acknowledge researchers."],
    ],
  },
  {
    h: "Compliance posture",
    items: [
      ["SOC 2 Type I", "In progress, target Q3. We can share the gap analysis under NDA today."],
      ["GDPR", "DPA available on request. EU data residency on the Frankfurt control plane."],
      ["Open source", "Agent is Apache-2. Anyone can audit the protocol or the runtime. The escape hatch is real."],
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-line-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 pt-20 pb-14">
            <div className="label-mono mb-3">Security</div>
            <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-[1.05] max-w-[20ch]">
              How we earn the keys to your fleet.
            </h1>
            <p className="mt-5 text-ink-2 text-[15px] leading-relaxed max-w-xl">
              Nixway sits in the deploy path of every workload you ship. The
              following is a plain-English summary of how we handle identity,
              data, and incidents. The long form lives in the docs.
            </p>
          </div>
        </section>

        <section className="bg-surface-0">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-16 space-y-16">
            {SECTIONS.map((s) => (
              <div key={s.h}>
                <h2 className="font-display italic text-3xl text-ink-1 leading-tight mb-6">
                  {s.h}
                </h2>
                <div className="border-t border-line-1">
                  {s.items.map(([k, v]) => (
                    <div
                      key={k}
                      className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-2 md:gap-8 py-5 border-b border-line-1"
                    >
                      <div className="text-ink-1 text-[14px] font-medium">{k}</div>
                      <p className="text-ink-2 text-[14px] leading-relaxed">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-7">
              <div className="label-mono mb-3">Report a vulnerability</div>
              <p className="text-ink-2 text-[14px] leading-relaxed">
                Email{" "}
                <a className="text-signal underline underline-offset-4" href="mailto:security@nixway.dev">
                  security@nixway.dev
                </a>{" "}
                with reproduction steps. We respond within one business day,
                publish an advisory once a fix is shipped, and credit
                researchers in the changelog.
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
