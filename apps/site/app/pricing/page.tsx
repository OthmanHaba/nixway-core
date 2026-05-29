import Link from "next/link";
import type { Metadata } from "next";
import { Check, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/primitives/Button";
import { consoleUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Nixway pricing. A flat per-seat fee for the control plane. Your servers stay on your AWS, Hetzner, or DigitalOcean bill at list price.",
};

const TIERS = [
  {
    name: "Solo",
    price: "$0",
    cadence: "forever",
    blurb: "For solo developers and tinkerers. Self-host on a single box.",
    cta: { label: "Start free", href: `${consoleUrl}/signup` },
    features: [
      "1 operator seat",
      "Unlimited servers (self-hosted control plane)",
      "Unlimited projects, environments, deploys",
      "Built-in metrics, logs, secrets, audit",
      "Community support",
    ],
  },
  {
    name: "Team",
    price: "$24",
    cadence: "per seat / month",
    blurb: "For teams shipping production workloads. Hosted control plane included.",
    cta: { label: "Start trial", href: `${consoleUrl}/signup` },
    featured: true,
    features: [
      "Up to 50 operator seats",
      "Hosted control plane with 99.9% SLA",
      "GitHub App + SSO (Google, GitHub)",
      "Multi-region private mesh",
      "Email support, 1 business day",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "annual",
    blurb: "For platform teams operating regulated or air-gapped workloads.",
    cta: { label: "Talk to us", href: "mailto:founders@nixway.dev?subject=Nixway%20Enterprise" },
    features: [
      "Unlimited seats and regions",
      "Self-hosted control plane on your VPC",
      "SAML SSO, SCIM, custom audit retention",
      "99.99% SLA, named slack channel",
      "Security review and DPA on request",
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-line-1">
          <div className="max-w-[1240px] mx-auto px-6 sm:px-10 pt-20 pb-14">
            <div className="label-mono mb-3">Pricing</div>
            <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-[1.05] max-w-[18ch]">
              Pay for the platform. Not the markup.
            </h1>
            <p className="mt-5 text-ink-2 text-[15px] leading-relaxed max-w-xl">
              We charge a flat per-seat fee for the control plane and console.
              Your servers stay on your provider bill at list price. No
              compute markup, no build-minute resale, no egress trap.
            </p>
          </div>
        </section>

        <section className="border-b border-line-1 bg-surface-0">
          <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-16">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {TIERS.map((t) => (
                <div
                  key={t.name}
                  className={`rounded-[var(--radius-lg)] border p-7 flex flex-col ${
                    t.featured
                      ? "border-signal/60 bg-surface-1 shadow-[0_24px_60px_-30px_color-mix(in_oklch,var(--signal)_50%,transparent)]"
                      : "border-line-1 bg-surface-1"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-1">
                      {t.name}
                    </div>
                    {t.featured && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">
                        Most teams
                      </span>
                    )}
                  </div>
                  <div className="mt-5 flex items-baseline gap-2">
                    <span className="font-display italic text-5xl text-ink-1 leading-none">
                      {t.price}
                    </span>
                    <span className="text-[12px] text-ink-3">{t.cadence}</span>
                  </div>
                  <p className="mt-3 text-ink-2 text-[13px] leading-relaxed">
                    {t.blurb}
                  </p>
                  <ul className="mt-6 space-y-2.5 flex-1">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[13px] text-ink-2">
                        <Check className="h-3.5 w-3.5 text-signal mt-[3px] shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-7">
                    <Button asChild variant={t.featured ? "primary" : "outline"} className="w-full">
                      <Link href={t.cta.href}>
                        {t.cta.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-line-1 pt-10 text-[13px]">
              <Footnote
                title="What you pay providers"
                body="Compute, storage, and egress on AWS, Hetzner, DigitalOcean, or any Linux box. Always at the provider's list price. Nixway never marks it up."
              />
              <Footnote
                title="What we charge you"
                body="A per-seat fee for the control plane, console, GitHub App, mesh networking, secrets, metrics, and the CLI. That's it."
              />
              <Footnote
                title="Startup credits"
                body="On AWS Activate, Azure for Startups, or GCP for Startups? Email us. We'll route the architecture review and unlock per-seat discounts for portfolio companies."
              />
            </div>
          </div>
        </section>

        <section className="border-b border-line-1 bg-surface-1">
          <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-16">
            <h2 className="font-display italic text-3xl text-ink-1 leading-tight mb-8">
              Common questions
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              {FAQ.map((q) => (
                <div key={q.q}>
                  <dt className="text-ink-1 text-[14px] font-medium">{q.q}</dt>
                  <dd className="mt-2 text-ink-2 text-[13px] leading-relaxed">{q.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

const FAQ = [
  {
    q: "Is the control plane truly self-hostable?",
    a: "Yes. The Team tier ships a hosted control plane for convenience, but the entire stack runs from one Docker Compose file. Enterprise customers run it inside their own VPC on the cloud of their choice.",
  },
  {
    q: "What counts as an operator seat?",
    a: "Any human with login access to the console or CLI. CI tokens and machine identities are free and unlimited.",
  },
  {
    q: "Do you have a Marketplace listing?",
    a: "AWS Marketplace listing is in progress. If your procurement team needs to spend a committed AWS budget, email us and we'll prioritise.",
  },
  {
    q: "Can I migrate from Heroku or Render?",
    a: "Yes. Most stacks port over by setting a Procfile or pointing at the existing Dockerfile. The migration guide covers buildpack mapping, env vars, and Postgres data transfer.",
  },
];

function Footnote({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="label-mono mb-2">{title}</div>
      <p className="text-ink-2 leading-relaxed">{body}</p>
    </div>
  );
}
