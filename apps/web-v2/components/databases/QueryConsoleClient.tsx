"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Clock,
  Database as DatabaseIcon,
  History,
  Play,
  ShieldAlert,
  Table as TableIcon,
  Wand2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { dbToolingApi, ApiError } from "@/lib/api";
import type { Database, QueryColumn, QueryResult, QueryRow } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  database: Database;
  /** Optional back link — usually the project-scoped detail URL. */
  backHref?: string;
}

export function QueryConsoleClient({ database, backHref }: Props) {
  const queryClient = useQueryClient();
  const [schema, setSchema] = useState<string>("");
  const [sql, setSql] = useState<string>("SELECT 1;");
  const [writeMode, setWriteMode] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const schemasQ = useQuery({
    queryKey: ["db-schemas", database.id],
    queryFn: () => dbToolingApi.listSchemas(database.id),
    enabled: database.status === "running",
    staleTime: 30_000,
  });

  // Pick the first schema once they load (prefer 'public' for postgres).
  useEffect(() => {
    if (schema || !schemasQ.data?.schemas?.length) return;
    const preferred = schemasQ.data.schemas.find((s) => s === "public");
    setSchema(preferred ?? schemasQ.data.schemas[0]);
  }, [schemasQ.data, schema]);

  const tablesQ = useQuery({
    queryKey: ["db-tables", database.id, schema],
    queryFn: () => dbToolingApi.listTables(database.id, schema),
    enabled: !!schema && database.status === "running",
    staleTime: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ["db-query-history", database.id],
    queryFn: () => dbToolingApi.listQueryHistory(database.id, 50),
    enabled: database.status === "running",
    staleTime: 30_000,
  });

  const run = useMutation({
    mutationFn: (input: { sql: string; write_mode: boolean }) =>
      dbToolingApi.runQuery(database.id, input),
    onSuccess: (res) => {
      setResult(res);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["db-query-history", database.id] });
    },
    onError: (e) => {
      setResult(null);
      setError(e instanceof ApiError ? e.message : "Query failed.");
    },
  });

  function execute() {
    const text = sql.trim();
    if (!text) return;
    setError(null);
    run.mutate({ sql: text, write_mode: writeMode });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  }

  function loadTable(name: string) {
    const stmt = `SELECT * FROM "${schema}"."${name}"\nLIMIT 100;`;
    setSql(stmt);
    setWriteMode(false);
    editorRef.current?.focus();
  }

  function loadHistory(text: string, mode: boolean) {
    setSql(text);
    setWriteMode(mode);
    editorRef.current?.focus();
  }

  const stopped = database.status !== "running";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {backHref && (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-signal transition-colors mb-1"
            >
              <ArrowLeft className="h-3 w-3" /> back to {database.name}
            </Link>
          )}
          <div className="flex items-center gap-2">
            <DatabaseIcon className="h-4 w-4 text-ink-3" />
            <h1 className="text-[20px] text-ink-1 font-mono truncate">{database.name}</h1>
            <Badge tone={dbTone(database.status)} dot={database.status === "running"}>
              {database.status}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            {database.template_slug} {database.version} · port {database.port}
          </p>
        </div>
      </div>

      {stopped && (
        <Alert tone="warn">
          The database is <span className="text-ink-1">{database.status}</span>. Start it to
          browse schemas and run queries.
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-2 lg:max-h-[calc(100dvh-120px)] lg:overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <div className="label-mono">Schema</div>
            <Select
              value={schema}
              onValueChange={setSchema}
              disabled={!schemasQ.data?.schemas?.length}
            >
              <SelectTrigger>
                <SelectValue placeholder="Schema" />
              </SelectTrigger>
              <SelectContent>
                {(schemasQ.data?.schemas ?? []).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="inline-flex items-center gap-2">
                      <Box className="h-3 w-3 text-ink-3" />
                      <span className="font-mono text-[12px]">{s}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="label-mono">Tables</div>
            {!schema ? (
              <p className="text-[12px] text-ink-3">
                Pick a schema to see its tables.
              </p>
            ) : tablesQ.isLoading ? (
              <p className="font-mono text-[11px] text-ink-3">loading…</p>
            ) : (tablesQ.data?.tables.length ?? 0) === 0 ? (
              <p className="text-[12px] text-ink-3">No tables in this schema.</p>
            ) : (
              <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden">
                {tablesQ.data!.tables.map((t) => (
                  <li key={t.name}>
                    <button
                      type="button"
                      onClick={() => loadTable(t.name)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
                    >
                      <TableIcon className="h-3 w-3 text-ink-3" />
                      <span className="font-mono text-[12px] text-ink-1 truncate flex-1">
                        {t.name}
                      </span>
                      <span className="font-mono text-[10px] text-ink-4 num">
                        {t.row_count >= 0 ? formatRowCount(t.row_count) : "—"}
                      </span>
                      <ChevronRight className="h-3 w-3 text-ink-4 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Main */}
        <div className="space-y-4 min-w-0">
          {/* Editor */}
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-[#0c0d12] overflow-hidden">
            <header className="flex items-center justify-between px-3 py-2 border-b border-line-1 bg-surface-1/40">
              <div className="label-mono flex items-center gap-2 text-ink-2">
                <Wand2 className="h-3 w-3" /> Query
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={writeMode}
                    onChange={(e) => setWriteMode(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[color:var(--alert)]"
                  />
                  <span className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-3">
                    Write mode
                  </span>
                </label>
                {writeMode && (
                  <Badge tone="alert" dot>
                    Destructive
                  </Badge>
                )}
                <Button
                  type="button"
                  onClick={execute}
                  loading={run.isPending}
                  disabled={!sql.trim() || stopped}
                  size="sm"
                >
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
              </div>
            </header>
            <textarea
              ref={editorRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleKey}
              spellCheck={false}
              autoComplete="off"
              className="w-full min-h-[180px] bg-[#0c0d12] text-[#cbd2e0] font-mono text-[13px] leading-[1.55] p-3 outline-none border-none resize-y"
              placeholder="-- ⌘/Ctrl + Enter to run"
            />
            <div className="px-3 py-1.5 border-t border-line-1 bg-surface-1/40 flex items-center justify-between font-mono text-[10px] text-ink-4">
              <span>{sql.length} chars</span>
              <span>
                <span className="font-mono">⌘</span>↵ runs ·{" "}
                <span className="font-mono">esc</span> clears
              </span>
            </div>
          </div>

          {error && (
            <Alert tone="error">
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5" /> {error}
              </span>
            </Alert>
          )}

          {result && (
            <div className="space-y-3">
              {result.error ? (
                <Alert tone="error">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Query failed
                    </div>
                    <pre className="font-mono text-[12px] whitespace-pre-wrap">{result.error}</pre>
                  </div>
                </Alert>
              ) : null}

              <div className="flex items-center gap-3 flex-wrap">
                {result.success && <Badge tone="online" dot>ok</Badge>}
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3 num">
                  <Clock className="h-3 w-3" /> {result.execution_time_ms} ms
                </span>
                {typeof result.affected_rows === "number" && result.affected_rows > 0 && (
                  <span className="font-mono text-[11px] text-ink-3 num">
                    {result.affected_rows} affected
                  </span>
                )}
                {result.rows && (
                  <span className="font-mono text-[11px] text-ink-3 num">
                    {result.rows.length} rows
                  </span>
                )}
              </div>

              {result.columns && result.rows && result.rows.length > 0 ? (
                <ResultsTable columns={result.columns} rows={result.rows} />
              ) : (
                result.success && !result.error && !result.affected_rows && (
                  <p className="text-[13px] text-ink-3">No rows returned.</p>
                )
              )}
            </div>
          )}

          {/* Query history */}
          <section className="space-y-3 pt-2">
            <div className="flex items-end justify-between">
              <div className="label-mono inline-flex items-center gap-2">
                <History className="h-3 w-3" /> Recent queries
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                {historyQ.data?.length ?? 0}
              </span>
            </div>
            {(historyQ.data?.length ?? 0) === 0 ? (
              <p className="text-[12px] text-ink-3">
                Ran queries will show up here. Click an entry to load it back into the editor.
              </p>
            ) : (
              <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden">
                {historyQ.data!.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => loadHistory(h.query_text, h.write_mode)}
                      className="w-full grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 transition-colors"
                    >
                      {h.error ? (
                        <Badge tone="alert">error</Badge>
                      ) : h.write_mode ? (
                        <Badge tone="warn">write</Badge>
                      ) : (
                        <Badge tone="neutral">read</Badge>
                      )}
                      <span className="font-mono text-[11px] text-ink-1 truncate">
                        {h.query_text.replace(/\s+/g, " ").trim()}
                      </span>
                      <span className="font-mono text-[10px] text-ink-3 num shrink-0">
                        {h.row_count != null ? `${h.row_count} rows` : "—"}
                      </span>
                      <span className="font-mono text-[10px] text-ink-4 num shrink-0">
                        {h.execution_time_ms != null ? `${h.execution_time_ms} ms` : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ResultsTable({
  columns,
  rows,
}: {
  columns: QueryColumn[];
  rows: QueryRow[];
}) {
  // Materialise into HTML manually so we can render NULLs distinctly and avoid
  // any sneaky innerHTML paths — values arrive as plain strings already.
  const heads = useMemo(() => columns.map((c) => c.name).join("|"), [columns]);
  return (
    <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 overflow-auto max-h-[60vh]">
      <table className="w-full text-left border-collapse">
        <thead className="bg-surface-2/50 sticky top-0">
          <tr key={heads}>
            {columns.map((c) => (
              <th
                key={c.name}
                className="px-3 py-2 border-b border-line-1 text-left align-bottom"
              >
                <div className="font-mono text-[11px] text-ink-1">{c.name}</div>
                {c.type_name && (
                  <div className="label-mono text-ink-4 mt-0.5">{c.type_name}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={cn(
                "border-b border-line-1 last:border-b-0",
                i % 2 === 1 && "bg-surface-2/30",
              )}
            >
              {columns.map((c, ci) => {
                const isNull = r.nulls?.[ci] ?? false;
                const val = r.values?.[ci] ?? "";
                return (
                  <td key={ci} className="px-3 py-2 align-top">
                    {isNull ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                        null
                      </span>
                    ) : (
                      <span className="font-mono text-[12px] text-ink-1 break-all">
                        {val}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function dbTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "running":      return "online";
    case "provisioning": return "signal";
    case "stopped":      return "warn";
    case "error":
    case "deleted":      return "alert";
    default:             return "neutral";
  }
}

function formatRowCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
