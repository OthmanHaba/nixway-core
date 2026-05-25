"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grain min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-6">
        <div className="label-mono text-alert">System fault</div>
        <h1 className="font-display italic text-5xl text-ink-1 leading-none">
          Something tripped.
        </h1>
        <p className="text-ink-2">An unexpected error interrupted the request.</p>
        {error.digest && (
          <p className="font-mono text-[11px] text-ink-3">trace · {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-signal hover:underline underline-offset-4"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
