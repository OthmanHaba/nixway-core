/* The hexagonal mesh icon IS the brand. Pair it with the wordmark in
   sidebar / header / footer contexts. The mark uses logo-dark on dark
   surfaces (every public-facing page is dark-locked) and falls back to
   logo-light under light mode. Sized small enough to live in a 64px
   topbar without dominating it. */

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <span
        className="relative inline-block shrink-0 rounded-[4px] overflow-hidden bg-surface-0"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-dark.png"
          alt=""
          width={size}
          height={size}
          className="hidden dark:block"
          decoding="async"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-light.png"
          alt=""
          width={size}
          height={size}
          className="block dark:hidden"
          decoding="async"
        />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono uppercase tracking-[0.18em] text-ink-1 text-[12px] font-medium">
          Nixway
        </span>
        <span className="font-mono uppercase tracking-[0.18em] text-ink-3 text-[12px]">
          {"//core"}
        </span>
      </span>
    </div>
  );
}
