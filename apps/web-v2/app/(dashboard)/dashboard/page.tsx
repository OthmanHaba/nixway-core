import { requireUser } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";

export const metadata = { title: "Overview · Nixway Core" };

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = (user.name || user.email).split(/\s+/)[0];

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1200px] mx-auto">
      {/* hero */}
      <div className="mb-10 reveal reveal-1">
        <div className="label-mono mb-3">Console · overview</div>
        <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-none">
          Good to see you, {firstName}.
        </h1>
        <p className="mt-4 text-ink-2 max-w-xl">
          The new console is taking shape. Phase 1 lays the foundation —
          authentication, shell, design tokens. Feature surfaces arrive next.
        </p>
      </div>

      {/* status row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10 reveal reveal-2">
        <StatCard label="Mesh"     value="42/42"  status="on"   suffix="links" />
        <StatCard label="Servers"  value="07"     status="on"   suffix="online" />
        <StatCard label="Builds"   value="03"     status="warn" suffix="queued" />
        <StatCard label="Alerts"   value="00"     status="on"   suffix="firing" />
      </div>

      {/* phase progress */}
      <Card className="reveal reveal-3">
        <CardHeader>
          <div className="label-mono mb-1">Migration · phase 1</div>
          <h2 className="text-xl text-ink-1">Foundation</h2>
        </CardHeader>
        <CardBody>
          <ul className="space-y-3 text-[13px] text-ink-2">
            <Row done>Next.js 15 App Router scaffold</Row>
            <Row done>Mission Control design tokens (OKLCH, hairlines, mono labels)</Row>
            <Row done>Radix-based primitive library</Row>
            <Row done>API client + session-aware RSC auth gates</Row>
            <Row done>Auth flows (login, signup, recovery, verification)</Row>
            <Row done>Sidebar + topbar shell</Row>
            <Row pending>Phase 2 — feature pages (servers, clusters, projects, apps)</Row>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  status,
}: {
  label: string;
  value: string;
  suffix: string;
  status: "on" | "warn" | "off";
}) {
  const dot =
    status === "on" ? "bg-online" : status === "warn" ? "bg-warn" : "bg-ink-4/40";
  return (
    <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="label-mono">{label}</span>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl text-ink-1 num">{value}</span>
        <span className="text-[11px] text-ink-3">{suffix}</span>
      </div>
    </div>
  );
}

function Row({ done, pending, children }: { done?: boolean; pending?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          (done ? "bg-online" : pending ? "bg-warn" : "bg-ink-4/40")
        }
      />
      <span className={done ? "text-ink-1" : "text-ink-2"}>{children}</span>
    </li>
  );
}
