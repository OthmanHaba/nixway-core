import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface DocPageProps {
  eyebrow: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
  prev?: { href: string; label: string };
  next?: { href: string; label: string };
}

export function DocPage({ eyebrow, title, lede, children, prev, next }: DocPageProps) {
  return (
    <article className="max-w-[760px] mx-auto px-6 sm:px-10 py-14">
      <div className="label-mono mb-3">{eyebrow}</div>
      <h1 className="font-display italic text-5xl text-ink-1 leading-[1.05] pb-1">
        {title}
      </h1>
      {lede && (
        <p className="mt-5 text-ink-2 text-[16px] leading-relaxed max-w-[60ch]">
          {lede}
        </p>
      )}
      <hr className="my-10 border-line-1" />
      <div className="prose-docs">{children}</div>

      {(prev || next) && (
        <nav className="mt-14 pt-6 border-t border-line-1 flex items-center justify-between gap-4">
          {prev ? (
            <Link
              href={prev.href}
              className="group inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink-1"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-ink-3 group-hover:text-signal transition-colors" />
              <span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                  Previous
                </span>
                <span className="block">{prev.label}</span>
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={next.href}
              className="group inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink-1 text-right"
            >
              <span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                  Next
                </span>
                <span className="block">{next.label}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-ink-3 group-hover:text-signal transition-colors" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </article>
  );
}
