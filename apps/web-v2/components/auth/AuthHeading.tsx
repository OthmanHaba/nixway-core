interface AuthHeadingProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
}

export function AuthHeading({ eyebrow, title, subtitle }: AuthHeadingProps) {
  return (
    <header className="space-y-3 mb-9">
      <div className="label-mono reveal reveal-1">{eyebrow}</div>
      <h1 className="font-display italic text-[52px] leading-[0.95] text-ink-1 reveal reveal-2">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[14px] text-ink-2 leading-relaxed max-w-[36ch] reveal reveal-3">
          {subtitle}
        </p>
      )}
    </header>
  );
}
