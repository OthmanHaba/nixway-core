import Link from "next/link";
import { Button } from "@/components/primitives/Button";

/* Single full-width editorial moment. Built for the AWS Activate and
   VC-pitch crowd reading the site: signals legitimacy, AWS alignment,
   and a real business model. */

export function ForFounders() {
  return (
    <section className="border-b border-line-1 bg-surface-0 relative">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] pointer-events-none crosshatch"
      />
      <div className="relative max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-14 items-end">
          <div>
            <h2 className="font-display italic text-4xl sm:text-5xl lg:text-[3.5rem] text-ink-1 leading-[1.05] max-w-[18ch]">
              Stop renting platform margin. Spend it on growth.
            </h2>
            <p className="mt-6 text-ink-2 text-[15px] leading-relaxed max-w-[58ch]">
              Most early-stage teams burn the first $50,000 of their AWS bill
              on a managed PaaS that resells those same servers at five to ten
              times list price. Nixway runs on the AWS account you already
              have, so every dollar of cloud credit stays cloud credit.
            </p>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl">
              <Block
                k="AWS-native"
                v="One-click deploy to EC2, Lightsail, and Graviton. Marketplace listing in progress."
              />
              <Block
                k="Cloud credit safe"
                v="Workloads stay on your AWS Activate, Azure for Startups, or GCP for Startups account."
              />
              <Block
                k="Open core"
                v="Apache-2 agent. Open architecture. No proprietary build format you'll regret."
              />
            </div>
          </div>

          <aside className="rounded-[var(--radius-lg)] border border-line-2 bg-surface-1 p-7">
            <div className="label-mono mb-3">For investors</div>
            <p className="text-ink-1 text-[15px] leading-relaxed">
              We&rsquo;re building the operator console for the next decade of
              dev tools. If you back infrastructure, we&rsquo;d love a
              conversation.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button asChild variant="outline" size="md">
                <Link href="mailto:founders@nixway.dev?subject=Nixway%20investor%20intro">
                  founders@nixway.dev
                </Link>
              </Button>
              <Button asChild variant="ghost" size="md">
                <Link href="/about">Read the founder story</Link>
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function Block({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-t border-line-1 pt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal mb-2">
        {k}
      </div>
      <p className="text-ink-2 text-[13px] leading-relaxed">{v}</p>
    </div>
  );
}
