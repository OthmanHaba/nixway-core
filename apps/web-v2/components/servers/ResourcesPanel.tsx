import { Cpu, HardDrive, Layers, Network, MemoryStick } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { EmptyState } from "@/components/primitives/EmptyState";
import type { ServerResources } from "@/lib/types";

export function ResourcesPanel({ resources }: { resources: ServerResources | null | undefined }) {
  if (!resources) {
    return (
      <EmptyState
        icon={<Cpu className="h-4 w-4" />}
        title="No hardware snapshot yet"
        body="The agent reports CPU, memory, disks, and network details shortly after onboarding. Check back once the server is online."
      />
    );
  }

  const memUsedPct = memoryPct(resources.memory_total, resources.memory_available);
  const disks = parseList(resources.disks);
  const nics = parseList(resources.network_interfaces);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* CPU */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Cpu className="h-3 w-3" /> Compute
          </div>
          <h2 className="text-[16px] text-ink-1">CPU</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <Row label="Model">
            <span className="font-mono text-[12px] text-ink-1">
              {resources.cpu_model ?? "—"}
            </span>
          </Row>
          <Row label="Cores">
            <span className="font-mono text-[18px] text-ink-1 num">
              {resources.cpu_cores ?? "—"}
            </span>
          </Row>
        </CardBody>
      </Card>

      {/* Memory */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <MemoryStick className="h-3 w-3" /> Memory
          </div>
          <h2 className="text-[16px] text-ink-1">RAM</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <Row label="Total"><span className="font-mono text-ink-1 num">{formatBytes(resources.memory_total)}</span></Row>
          <Row label="Available"><span className="font-mono text-ink-1 num">{formatBytes(resources.memory_available)}</span></Row>
          {memUsedPct !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="label-mono">Used</span>
                <span className="font-mono text-ink-2 num">{memUsedPct.toFixed(0)}%</span>
              </div>
              <div className="h-[3px] rounded-full bg-surface-3 overflow-hidden">
                <div
                  className={`${memUsedPct > 85 ? "bg-alert" : memUsedPct > 65 ? "bg-warn" : "bg-online"} h-full transition-[width] duration-500`}
                  style={{ width: `${memUsedPct}%` }}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Platform */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Layers className="h-3 w-3" /> Platform
          </div>
          <h2 className="text-[16px] text-ink-1">Kernel + container runtime</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[12px]">
            <Stat label="Kernel">{resources.kernel_version ?? "—"}</Stat>
            <Stat label="Docker">{resources.docker_version ?? "—"}</Stat>
            <Stat label="Snapshot">{formatDate(resources.updated_at)}</Stat>
          </dl>
        </CardBody>
      </Card>

      {/* Disks */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <HardDrive className="h-3 w-3" /> Storage
          </div>
          <h2 className="text-[16px] text-ink-1">Disks</h2>
        </CardHeader>
        <CardBody>
          {disks.length === 0 ? (
            <p className="text-[12px] text-ink-3">No disks reported.</p>
          ) : (
            <ul className="space-y-2 text-[12px]">
              {disks.map((disk, i) => (
                <li key={i} className="rounded-[var(--radius-sm)] border border-line-1 bg-surface-2/40 px-3 py-2 font-mono text-[11px] text-ink-2 break-all">
                  {summarise(disk)}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Network */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Network className="h-3 w-3" /> Networking
          </div>
          <h2 className="text-[16px] text-ink-1">Interfaces</h2>
        </CardHeader>
        <CardBody>
          {nics.length === 0 ? (
            <p className="text-[12px] text-ink-3">No interfaces reported.</p>
          ) : (
            <ul className="space-y-2 text-[12px]">
              {nics.map((nic, i) => (
                <li key={i} className="rounded-[var(--radius-sm)] border border-line-1 bg-surface-2/40 px-3 py-2 font-mono text-[11px] text-ink-2 break-all">
                  {summarise(nic)}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-mono">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="label-mono">{label}</div>
      <div className="font-mono text-[12px] text-ink-1">{children}</div>
    </div>
  );
}

function memoryPct(total: number | null, available: number | null): number | null {
  if (total == null || total <= 0 || available == null) return null;
  const used = total - available;
  if (used < 0) return 0;
  return (used / total) * 100;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
}

function summarise(item: unknown): string {
  if (item == null) return "—";
  if (typeof item === "string") return item;
  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;
    // Pick a few likely-friendly fields if present
    const parts: string[] = [];
    for (const k of ["name", "device", "mount", "mountpoint", "fstype", "size", "size_bytes", "addr", "ip", "ipv4", "mac"]) {
      if (k in obj) parts.push(`${k}=${String(obj[k])}`);
    }
    if (parts.length > 0) return parts.join("  ");
    return JSON.stringify(obj);
  }
  return String(item);
}
