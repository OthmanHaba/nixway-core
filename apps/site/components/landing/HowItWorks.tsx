/* Vertical narrative with connectors. Different layout family from the
   bento above. Uses real CLI commands as the visual evidence. */

const STEPS = [
  {
    n: "01",
    title: "Register a server",
    body: "Add a bare-metal box, an EC2 instance, a Hetzner dedicated, or a Lightsail VM. Nixway installs an agent over SSH and starts heartbeating in under a minute.",
    cli: "$ nixway servers add fra-edge-01 --ssh ubuntu@5.75.198.42",
  },
  {
    n: "02",
    title: "Create a project, connect a repo",
    body: "Pick a project name, point Nixway at a GitHub repo, and choose a branch per environment. Buildpacks auto-detect Node, Go, Python, Rust, and Bun. Bring a Dockerfile if you have one.",
    cli: "$ nixway projects create orbit-api --repo orbit/api --branch main",
  },
  {
    n: "03",
    title: "Push. Watch it land.",
    body: "git push triggers a build on your fleet, an image push to the internal registry, a rolling deploy across regions, automatic TLS, and a green health check. Promote to production with one command.",
    cli: "$ git push && nixway tail orbit-api",
  },
];

export function HowItWorks() {
  return (
    <section className="border-b border-line-1 bg-surface-1">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2.2fr] gap-12 lg:gap-20 items-start">
          <div className="lg:sticky lg:top-24">
            <h2 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-[1.05]">
              Three commands to a live URL.
            </h2>
            <p className="mt-4 text-ink-2 text-[15px] leading-relaxed max-w-md">
              No Kubernetes manifests, no Terraform modules, no platform team.
              Just push the branch.
            </p>
          </div>

          <ol className="relative space-y-12">
            {/* spine */}
            <span
              aria-hidden
              className="absolute left-[14px] top-2 bottom-2 w-px bg-line-1 hidden sm:block"
            />
            {STEPS.map((s) => (
              <li key={s.n} className="relative pl-0 sm:pl-12">
                <span
                  aria-hidden
                  className="hidden sm:grid absolute left-0 top-0 h-7 w-7 place-items-center rounded-full border border-line-2 bg-surface-0 font-mono text-[10px] text-signal"
                >
                  {s.n}
                </span>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3 sm:hidden mb-1">
                  Step {s.n}
                </div>
                <h3 className="text-ink-1 text-[18px] font-medium">{s.title}</h3>
                <p className="mt-2 text-ink-2 text-[14px] leading-relaxed max-w-[58ch]">
                  {s.body}
                </p>
                <pre className="mt-4 rounded-[var(--radius)] border border-line-1 bg-surface-0 px-4 py-3 text-[12.5px] font-mono text-ink-2 overflow-x-auto">
                  <span className="text-signal">{s.cli.slice(0, 1)}</span>
                  {s.cli.slice(1)}
                </pre>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
