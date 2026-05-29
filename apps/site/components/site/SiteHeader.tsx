import Link from "next/link";
import { Logo } from "@/components/primitives/Logo";
import { Button } from "@/components/primitives/Button";
import { consoleUrl } from "@/lib/site";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/customers", label: "Customers" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-line-1 bg-surface-0/85 backdrop-blur">
      <div className="h-full max-w-[1240px] mx-auto px-6 sm:px-10 flex items-center justify-between gap-6">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden md:flex items-center gap-7">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-[13px] text-ink-2 hover:text-ink-1 transition-colors"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href={consoleUrl}>Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`${consoleUrl}/signup`}>Start free</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
