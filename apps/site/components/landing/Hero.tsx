import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { consoleUrl } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-line-1">
      <div aria-hidden className="absolute inset-0 crosshatch opacity-60" />
      <div
        aria-hidden
        className="absolute -top-32 -right-40 h-[420px] w-[420px] rounded-full blur-3xl opacity-25"
        style={{ background: "radial-gradient(circle, var(--signal), transparent 60%)" }}
      />

      <div className="relative max-w-[1240px] mx-auto px-6 sm:px-10 pt-20 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-start">
          {/* Hero stack: eyebrow + headline + subtext + CTAs = 4 elements, locked. */}
          <div className="reveal reveal-1">
            <div className="label-mono flex items-center gap-3">
              <span>Nixway // Core</span>
              <span className="h-px w-12 bg-line-2" />
              <span>self-hosted PaaS</span>
            </div>
            <h1 className="mt-6 font-display italic text-ink-1 text-[3rem] sm:text-6xl lg:text-[4.25rem] leading-[1.05]">
              Ship to your fleet,
              <br />
              like it&rsquo;s Heroku.
            </h1>
            <p className="mt-6 text-ink-2 text-[15px] leading-relaxed max-w-[36ch]">
              Push to a Git repo. Nixway builds, deploys, and routes across the
              servers you already own. Heroku-grade developer experience,
              AWS-bill cost basis.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href={`${consoleUrl}/signup`}>
                  Start free
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/docs/getting-started">Read the docs</Link>
              </Button>
            </div>
          </div>

          <div className="reveal reveal-2">
            <HeroTerminal />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroTerminal() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden shadow-[0_24px_60px_-30px_color-mix(in_oklch,var(--ink-1)_60%,transparent)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line-1 bg-surface-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-alert/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-online/70" />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
          nixway · cli
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online pulse-online" />
          live
        </div>
      </div>
      <pre className="term px-5 py-4 overflow-x-auto whitespace-pre">
        <Line>
          <P>$</P> <C>nixway login</C>
        </Line>
        <Line>
          <Ok>✓</Ok> Signed in as ada@orbit.co
        </Line>
        <Line>&nbsp;</Line>
        <Line>
          <P>$</P> <C>nixway deploy --project orbit-api</C>
        </Line>
        <Line>
          <D>→</D> Resolving 3 servers <D>·</D> us-east-1, fra-1, sgp-1
        </Line>
        <Line>
          <D>→</D> Building image <D>·</D> cache HIT (87%)
        </Line>
        <Line>
          <D>→</D> Pushing to internal registry <D>·</D> 18.4 MB
        </Line>
        <Line>
          <D>→</D> Health check <D>·</D> /healthz 200 in 412ms
        </Line>
        <Line>
          <D>→</D> Routing <D>·</D> orbit-api.apps.orbit.co (TLS issued)
        </Line>
        <Line>&nbsp;</Line>
        <Line>
          <Ok>✓</Ok> orbit-api <D>·</D> v124 live in 38s
        </Line>
      </pre>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
const P = ({ children }: { children: React.ReactNode }) => (
  <span className="prompt">{children}</span>
);
const C = ({ children }: { children: React.ReactNode }) => (
  <span className="cmd">{children}</span>
);
const D = ({ children }: { children: React.ReactNode }) => (
  <span className="dim">{children}</span>
);
const Ok = ({ children }: { children: React.ReactNode }) => (
  <span className="ok">{children}</span>
);
