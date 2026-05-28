/**
 * Decorative right-side panel for auth pages.
 * A simulated operator console — region map, telemetry strip, version stamp.
 * Pure SSR-safe markup, no random values, no flashing — restrained motion.
 */
export function StatusPanel() {
  return (
    <div className="relative h-full flex flex-col">
      {/* gradient field + grid */}
      <div className="absolute inset-0 crosshatch" aria-hidden />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 70% 20%, color-mix(in oklch, var(--signal) 22%, transparent), transparent 70%), radial-gradient(ellipse 80% 60% at 20% 90%, color-mix(in oklch, var(--info) 16%, transparent), transparent 65%)",
        }}
      />

      {/* corner brackets — operator console reference frame */}
      <CornerBrackets />

      {/* top tickers */}
      <div className="relative z-10 px-10 pt-10 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.14em] text-ink-3">
        <div className="flex gap-6">
          <Ticker label="Region" value="us-east-1" />
          <Ticker label="Mesh"   value="42 / 42"   />
          <Ticker label="Builds" value="3 active"  />
        </div>
        <div className="text-ink-4">{TIMESTAMP}</div>
      </div>

      {/* center mark */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-ink-3 mb-6">
          Operator console
        </div>
        <h2 className="font-display italic text-[68px] leading-[0.95] text-ink-1">
          Run your <br /> own cloud.
        </h2>
        <p className="mt-6 max-w-sm text-[14px] text-ink-2 leading-relaxed">
          Deploy services, provision databases, and orchestrate fleets across
          bare metal — without leaving the terminal.
        </p>
      </div>

      {/* fleet matrix — abstract LED strip */}
      <div className="relative z-10 px-10 pb-10">
        <div className="flex items-center justify-between mb-3 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-3">
          <span>Fleet · cluster &lsquo;atlas&rsquo;</span>
          <span className="text-online">live</span>
        </div>
        <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
          {CELLS.map((tone, i) => (
            <span
              key={i}
              className={cellClass(tone)}
              style={{ animationDelay: `${(i % 12) * 30}ms` }}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4">
          <LegendDot tone="on" /> healthy · 38
          <LegendDot tone="warn" /> drift · 3
          <LegendDot tone="off" /> idle · 1
        </div>
      </div>
    </div>
  );
}

function Ticker({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ink-4">{label}</span>
      <span className="text-ink-1 num">{value}</span>
    </div>
  );
}

function LegendDot({ tone }: { tone: "on" | "warn" | "off" }) {
  const cls =
    tone === "on" ? "bg-online" : tone === "warn" ? "bg-warn" : "bg-ink-4/40";
  return <span className={`inline-block h-1.5 w-1.5 rounded-[1px] ${cls}`} />;
}

function cellClass(tone: "on" | "warn" | "off") {
  const base = "h-3 rounded-[1px] reveal";
  if (tone === "on")   return `${base} bg-online/80`;
  if (tone === "warn") return `${base} bg-warn/80`;
  return `${base} bg-ink-4/15`;
}

function CornerBrackets() {
  const arm = "absolute h-px w-6 bg-line-2";
  const armV = "absolute w-px h-6 bg-line-2";
  return (
    <>
      <span className={`${arm} top-6 left-6`} />
      <span className={`${armV} top-6 left-6`} />
      <span className={`${arm} top-6 right-6`} />
      <span className={`${armV} top-6 right-6`} />
      <span className={`${arm} bottom-6 left-6`} />
      <span className={`${armV} bottom-[28px] left-6`} />
      <span className={`${arm} bottom-6 right-6`} />
      <span className={`${armV} bottom-[28px] right-6`} />
    </>
  );
}

// 24 × 5 = 120 deterministic cells. Pattern is fixed so SSR matches client.
const CELLS: ("on" | "warn" | "off")[] = (() => {
  const out: ("on" | "warn" | "off")[] = [];
  const off = new Set([7, 51]);
  const warn = new Set([12, 38, 89]);
  for (let i = 0; i < 120; i++) {
    if (off.has(i)) out.push("off");
    else if (warn.has(i)) out.push("warn");
    else out.push("on");
  }
  return out;
})();

// Static deterministic stamp so SSR === client. The login screen doesn't need real time.
const TIMESTAMP = "T+0742h · sync ok";
