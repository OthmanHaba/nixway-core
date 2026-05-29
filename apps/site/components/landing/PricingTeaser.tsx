import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { consoleUrl } from "@/lib/site";

/* Two-column split. NOT a 3-tier pricing table — the full table lives at
   /pricing. The point of this section is the pricing thesis. */

export function PricingTeaser() {
  return (
    <section className="border-b border-line-1 bg-surface-1">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
          <div>
            <div className="label-mono mb-3">Pricing thesis</div>
            <h2 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-[1.05]">
              You already pay AWS.
              <br />
              Stop paying a 10x markup on top.
            </h2>
            <p className="mt-5 text-ink-2 text-[15px] leading-relaxed max-w-xl">
              Managed PaaS vendors mark up compute by 5x to 10x. Nixway charges
              a flat per-seat fee for the control plane. The servers stay on
              your AWS, Hetzner, or DigitalOcean bill, at list price.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/pricing">
                  See pricing
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <Link href={`${consoleUrl}/signup`}>Start free</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-line-2 bg-surface-0 p-7">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="label-mono">Worked example</div>
                <div className="mt-1 text-ink-1 text-[15px]">
                  A team running a typical SaaS workload
                </div>
              </div>
            </div>
            <table className="mt-6 w-full text-[13px]">
              <tbody className="divide-y divide-line-1">
                <Row label="8 vCPU, 16 GB, 3 regions" managed="$612 / mo" nixway="$98 / mo" />
                <Row label="Managed Postgres + replica" managed="$240 / mo" nixway="$54 / mo" />
                <Row label="Build minutes (200 / mo)" managed="$160 / mo" nixway="included" />
                <Row label="Egress (500 GB)" managed="$45 / mo" nixway="provider cost" />
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-5 text-ink-3 text-[12px] font-mono uppercase tracking-[0.14em]">
                    Monthly bill
                  </td>
                  <td className="pt-5 text-right text-ink-3 line-through font-mono num">$1,057</td>
                  <td className="pt-5 text-right text-signal font-mono num text-[16px]">$152</td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-4 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-4">
              Indicative. Actual costs vary by provider and region.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  managed,
  nixway,
}: {
  label: string;
  managed: string;
  nixway: string;
}) {
  return (
    <tr>
      <td className="py-3 text-ink-2">{label}</td>
      <td className="py-3 text-right text-ink-3 font-mono num">{managed}</td>
      <td className="py-3 text-right text-ink-1 font-mono num">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3 w-3 text-signal" />
          {nixway}
        </span>
      </td>
    </tr>
  );
}
