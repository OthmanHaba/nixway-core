import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/primitives/Button";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-[60dvh] grid place-items-center px-6">
        <div className="text-center">
          <div className="label-mono mb-3">404 · not found</div>
          <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-tight">
            Off the routing table.
          </h1>
          <p className="mt-5 text-ink-2 max-w-md mx-auto">
            That page doesn&rsquo;t exist, or it moved with a release. Try the
            docs index or head back to the home page.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <Button asChild>
              <Link href="/">Home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/docs">Docs</Link>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
