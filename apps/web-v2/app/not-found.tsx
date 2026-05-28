import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grain min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-6">
        <div className="label-mono">Signal lost · 404</div>
        <h1 className="font-display italic text-6xl text-ink-1 leading-none">
          Off the grid.
        </h1>
        <p className="text-ink-2">
          The route you tried to reach isn&rsquo;t in the mesh. Check the URL, or head back to the dashboard.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-signal hover:underline underline-offset-4"
        >
          <span className="font-mono text-xs tracking-[0.14em] uppercase">Return to control</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </main>
  );
}
