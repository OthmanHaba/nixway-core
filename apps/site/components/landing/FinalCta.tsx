import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { consoleUrl } from "@/lib/site";

export function FinalCta() {
  return (
    <section className="bg-surface-1">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="text-center">
          <h2 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-[1.05] max-w-[18ch] mx-auto">
            Operators love it. Try it on your fleet.
          </h2>
          <p className="mt-6 text-ink-2 text-[15px] leading-relaxed max-w-lg mx-auto">
            Free for solo developers and small teams. No credit card.
            Self-host in 10 minutes, or ship to our hosted control plane.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`${consoleUrl}/signup`}>
                Start free
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/docs/guides/self-host">Self-host guide</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
