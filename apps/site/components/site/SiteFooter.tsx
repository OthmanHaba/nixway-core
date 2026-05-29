import Link from "next/link";
import { Logo } from "@/components/primitives/Logo";

const COLS = [
  {
    title: "Product",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Security" },
      { href: "/customers", label: "Customers" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs/getting-started", label: "Getting started" },
      { href: "/docs/architecture", label: "Architecture" },
      { href: "/docs/cli", label: "CLI reference" },
      { href: "/docs/api", label: "HTTP API" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/customers", label: "Customers" },
      { href: "mailto:founders@nixway.dev", label: "Contact" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line-1 bg-surface-0">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 text-[13px] text-ink-3 max-w-xs leading-relaxed">
              Mission control for your fleet. Self-hosted Platform-as-a-Service,
              built for teams that outgrew Heroku but never wanted Kubernetes.
            </p>
            <div className="mt-5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4">
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online pulse-online" />
              <span>Platform · operational</span>
            </div>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <div className="label-mono mb-3">{col.title}</div>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[13px] text-ink-2 hover:text-ink-1 transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-line-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-4">
          <span>© 2026 Nixway, Inc. All rights reserved.</span>
          <span>Built for operators. Hosted on the cloud you already pay for.</span>
        </div>
      </div>
    </footer>
  );
}
