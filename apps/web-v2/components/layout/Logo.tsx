export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 select-none">
      <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-signal" />
      {!collapsed && (
        <>
          <span className="font-mono uppercase tracking-[0.18em] text-ink-1 text-[12px] font-medium">
            Nixway
          </span>
          <span className="font-mono uppercase tracking-[0.18em] text-ink-3 text-[12px]">
            {"//core"}
          </span>
        </>
      )}
    </div>
  );
}
