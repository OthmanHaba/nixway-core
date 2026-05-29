import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/primitives/Button";

export const metadata: Metadata = {
  title: "Customers",
  description:
    "Teams running production workloads on Nixway. Early access is open. Your logo could go here.",
};

export default function CustomersPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-line-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 pt-20 pb-14">
            <div className="label-mono mb-3">Customers</div>
            <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-[1.05] max-w-[22ch]">
              Operators shipping real workloads on Nixway.
            </h1>
            <p className="mt-5 text-ink-2 text-[15px] leading-relaxed max-w-xl">
              We&rsquo;re in private early access with a handful of design
              partners. Case studies land here as customers go on the record.
              If you want first dibs on the Team tier and a direct line to the
              founders, the form below is the fastest path.
            </p>
          </div>
        </section>

        <section className="bg-surface-0 border-b border-line-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-16 grid grid-cols-1 md:grid-cols-2 gap-6">
            <Quote
              text="The deploys are fast enough that I stopped tabbing to the console to watch them. That used to be my tell that a platform was good."
              who="Design partner"
              role="CTO, fintech (Series A)"
            />
            <Quote
              text="We replaced six homegrown bash scripts and a 400-line Terraform module with one nixway projects create."
              who="Design partner"
              role="Lead engineer, B2B SaaS"
            />
            <Quote
              text="The reverse-SSH model meant we didn't have to open a single new port. Security signed off in one meeting."
              who="Design partner"
              role="Head of platform, healthtech"
            />
            <Quote
              text="The pricing math made the call for us. We were paying $14,000 a month for what now costs us $1,700 of EC2 plus seats."
              who="Design partner"
              role="Founder, AI infra startup"
            />
          </div>
        </section>

        <section className="bg-surface-1">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-20 text-center">
            <h2 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-tight max-w-[20ch] mx-auto">
              Your logo could go here.
            </h2>
            <p className="mt-5 text-ink-2 text-[15px] leading-relaxed max-w-lg mx-auto">
              We pick design partners by hand: small teams shipping production
              workloads, willing to share war stories. Email us with your stack
              and the gnarliest deploy you handled last month.
            </p>
            <div className="mt-8">
              <Button asChild size="lg">
                <Link href="mailto:founders@nixway.dev?subject=Nixway%20design%20partner">
                  founders@nixway.dev
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Quote({ text, who, role }: { text: string; who: string; role: string }) {
  return (
    <figure className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-7">
      <blockquote className="text-ink-1 text-[15px] leading-relaxed">
        &ldquo;{text}&rdquo;
      </blockquote>
      <figcaption className="mt-5 pt-4 border-t border-line-1 flex items-center gap-3">
        <span className="h-7 w-7 rounded-full bg-surface-3 grid place-items-center font-mono text-[11px] text-signal">
          {who.slice(0, 1)}
        </span>
        <span className="text-[12px]">
          <span className="block text-ink-1">{who}</span>
          <span className="block text-ink-3">{role}</span>
        </span>
      </figcaption>
    </figure>
  );
}
