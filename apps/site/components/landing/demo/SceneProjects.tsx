import { Plus, GitBranch, Check, Star } from "lucide-react";

/* Scene 3 — Projects. New-project form on the left, GitHub repo
   picker on the right with realistic repo entries. Once "connected",
   the buildpack auto-detection output ticks in, and the project tile
   slides into the Recent grid. */

const REPOS = [
  { name: "orbit/api",    stars: "1.2k", updated: "2m ago",  selected: true  },
  { name: "orbit/web",    stars: "486",  updated: "9m ago",  selected: false },
  { name: "orbit/worker", stars: "192",  updated: "1h ago",  selected: false },
  { name: "orbit/cli",    stars: "84",   updated: "3h ago",  selected: false },
];

export function SceneProjects() {
  return (
    <div className="scene-projects h-full p-5 sm:p-7 relative">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Workloads
          </div>
          <h3 className="font-display italic text-[22px] sm:text-2xl text-ink-1 leading-tight mt-1">
            New project
          </h3>
        </div>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-signal text-[color:var(--signal-ink)] font-mono uppercase tracking-[0.14em] text-[10px] font-medium shadow-[inset_0_1px_0_color-mix(in_oklch,white_30%,transparent)]"
        >
          <Plus className="h-3 w-3" />
          Create
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.1fr] gap-3">
        {/* Form */}
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-4">
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-3">
            Configuration
          </div>
          <FormField label="Project name"   value="orbit-api" />
          <FormField label="Default branch" value="main"      mono />
          <FormField label="Cluster"        value="prod-edge" />
          <FormField label="Buildpack"      value="auto-detect" mono />

          <div className="mt-3 pt-3 border-t border-line-1">
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-1.5">
              Buildpack auto-detect
            </div>
            <ul className="space-y-1 font-mono text-[10.5px] text-ink-2">
              <li className="demo-detect-line demo-detect-line-0">
                <span className="text-ink-4">→</span> scanning package.json
              </li>
              <li className="demo-detect-line demo-detect-line-1 text-online">
                <span className="text-ink-4">✓</span> Node 22 detected
              </li>
              <li className="demo-detect-line demo-detect-line-2 text-online">
                <span className="text-ink-4">✓</span> Bun runtime preferred
              </li>
            </ul>
          </div>

          <div className="demo-form-connect mt-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-online">
            <Check className="h-3 w-3" />
            GitHub App authorised
          </div>
        </div>

        {/* GitHub repo picker */}
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-line-1 bg-surface-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="h-3 w-3 text-ink-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.71 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.47.11-3.07 0 0 .96-.31 3.16 1.18.92-.26 1.91-.39 2.9-.39s1.98.13 2.9.39c2.2-1.49 3.16-1.18 3.16-1.18.63 1.6.23 2.78.12 3.07.74.81 1.19 1.84 1.19 3.1 0 4.44-2.7 5.41-5.27 5.7.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
              </svg>
              <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
                Pick a repository
              </span>
            </div>
            <span className="font-mono text-[9px] text-ink-4">orbit org</span>
          </div>
          <ul className="divide-y divide-line-1">
            {REPOS.map((r, i) => (
              <li
                key={r.name}
                className={`demo-repo-row demo-repo-row-${i} grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2 ${
                  r.selected ? "bg-surface-2" : ""
                }`}
              >
                <span className="text-[11.5px] text-ink-1 truncate font-mono">{r.name}</span>
                <span className="inline-flex items-center gap-1 font-mono text-[9.5px] text-ink-3">
                  <Star className="h-2.5 w-2.5" />
                  {r.stars}
                </span>
                <span className="font-mono text-[9px] text-ink-4 w-14 text-right">
                  {r.updated}
                </span>
              </li>
            ))}
          </ul>

          {/* Project tile that slides in at the very end, replacing the picker footer */}
          <div className="border-t border-line-1 p-3">
            <div className="demo-project-tile rounded-[var(--radius-sm)] border border-line-2 bg-surface-0 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-ink-1 text-[12.5px] font-medium">orbit-api</span>
                <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] text-[9px] text-online">
                  <span className="h-1 w-1 rounded-full bg-online" />
                  connected
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-ink-3">
                <GitBranch className="h-2.5 w-2.5" />
                <span className="font-mono">orbit/api</span>
                <span>·</span>
                <span className="font-mono">main</span>
                <span>·</span>
                <span className="font-mono">a1c8e02</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="mb-2.5">
      <div className="font-mono uppercase tracking-[0.14em] text-[8.5px] text-ink-3 mb-1">
        {label}
      </div>
      <div className={`h-7 px-2 rounded-[var(--radius-sm)] border border-line-1 bg-surface-0 flex items-center text-[11px] text-ink-1 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
