import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/primitives/Button";

export const metadata: Metadata = {
  title: "About",
  description:
    "Nixway is a self-hosted Platform-as-a-Service built by operators who lived inside the AWS bill and decided to do something about it.",
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-line-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 pt-20 pb-16">
            <div className="label-mono mb-3">About Nixway</div>
            <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-[1.05] max-w-[20ch]">
              We&rsquo;re building the operator console for the next decade.
            </h1>
            <p className="mt-6 text-ink-2 text-[16px] leading-relaxed max-w-[60ch]">
              Every infrastructure team eventually arrives at the same fork:
              accept a 10x markup from a managed PaaS, or burn six months
              building Kubernetes glue. We were tired of choosing. So we built
              the platform we wanted.
            </p>
          </div>
        </section>

        <section className="border-b border-line-1 bg-surface-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-20 grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-12">
            <div>
              <div className="label-mono">Founder</div>
              <h2 className="mt-2 font-display italic text-3xl text-ink-1 leading-tight">
                Othman Haba
              </h2>
              <p className="mt-2 text-ink-3 text-[13px]">
                CEO &amp; cofounder
              </p>
            </div>
            <div className="prose-docs">
              <p>
                Othman has spent the last decade shipping infrastructure for
                startups that grew faster than their cloud bill could absorb.
                Nixway is the platform he wished existed at every previous
                company: Heroku-grade developer experience, self-hosted,
                operator-first, and honest about its costs.
              </p>
              <p>
                The product is built in Go and TypeScript. The control plane is
                a single binary plus Postgres and Redis. The agent is one
                static binary that runs anywhere Linux runs. The console is
                Next.js. There is no Kubernetes in the data path.
              </p>
              <p>
                We&rsquo;re hiring senior platform engineers. If you&rsquo;ve
                ever migrated a production workload off Heroku, we want to
                talk.
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-line-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-20">
            <h2 className="font-display italic text-3xl text-ink-1 leading-tight mb-10">
              How we think
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10 text-[14px] leading-relaxed">
              <Belief
                k="Operator first"
                v="Every screen, every command, every error message is written for the person on call at 3am. If a feature is hostile to operators, it doesn't ship."
              />
              <Belief
                k="Cost-honest"
                v="Compute belongs on the provider's bill at list price. We make money on the control plane. We will never resell your AWS at a markup."
              />
              <Belief
                k="Open core"
                v="The agent is Apache-2. The protocol is documented. The escape hatch is real. We earn renewals by being good, not by being sticky."
              />
            </div>
          </div>
        </section>

        <section className="border-b border-line-1 bg-surface-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-16">
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-10 items-center">
              <div>
                <div className="label-mono mb-3">Investors &amp; partners</div>
                <h2 className="font-display italic text-3xl text-ink-1 leading-tight max-w-[24ch]">
                  Backing the operator-first platform layer.
                </h2>
                <p className="mt-4 text-ink-2 text-[14px] leading-relaxed max-w-[55ch]">
                  We&rsquo;re raising a seed round to scale the hosted control
                  plane and ship the AWS Marketplace listing. If you fund
                  infrastructure, devtools, or developer-led growth, we&rsquo;d
                  love a conversation.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button asChild>
                  <Link href="mailto:founders@nixway.dev?subject=Nixway%20investor%20intro">
                    founders@nixway.dev
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/docs">Read the docs</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Belief({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-t border-line-1 pt-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal mb-2">
        {k}
      </div>
      <p className="text-ink-2">{v}</p>
    </div>
  );
}
