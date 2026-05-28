import type { ReactNode } from "react";
import { Activity, Network, Globe } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { ClusterStatusBadge } from "./ClusterStatusBadge";
import type { Cluster, ClusterMember } from "@/lib/types";

export function ClusterOverview({
  cluster,
  members,
}: {
  cluster: Cluster;
  members: ClusterMember[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* identity */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Network className="h-3 w-3" /> Identity
          </div>
          <h2 className="text-[16px] text-ink-1">Cluster</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <Row label="Slug"><span className="font-mono text-ink-1">{cluster.slug}</span></Row>
          <Row label="Status"><ClusterStatusBadge status={cluster.status} /></Row>
          <Row label="Created">
            <span className="font-mono text-ink-1 num">{formatDate(cluster.created_at)}</span>
          </Row>
        </CardBody>
      </Card>

      {/* topology */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Globe className="h-3 w-3" /> Topology
          </div>
          <h2 className="text-[16px] text-ink-1">Network</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <Row label="Region">
            <span className="font-mono text-ink-1 uppercase tracking-[0.14em] text-[10px]">
              {cluster.region || "—"}
            </span>
          </Row>
          <Row label="CIDR">
            <span className="font-mono text-ink-1 num">{cluster.cidr || "—"}</span>
          </Row>
          <Row label="DNS zone">
            <span className="font-mono text-ink-2">
              {cluster.slug ? `${cluster.slug}.internal` : "—"}
            </span>
          </Row>
        </CardBody>
      </Card>

      {/* members */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Activity className="h-3 w-3" /> Mesh
          </div>
          <h2 className="text-[16px] text-ink-1">Membership</h2>
        </CardHeader>
        <CardBody>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-mono text-3xl text-ink-1 num leading-none">
              {members.length.toString().padStart(2, "0")}
            </span>
            <span className="text-[12px] text-ink-3">
              {members.length === 1 ? "server" : "servers"}
            </span>
          </div>
          <p className="text-[11px] text-ink-3">
            Each member is a peer in the WireGuard mesh, addressable inside the cluster by name
            via the DNS zone.
          </p>
        </CardBody>
      </Card>

      {/* description */}
      {cluster.description && (
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="label-mono mb-1">Description</div>
          </CardHeader>
          <CardBody>
            <p className="text-[13px] text-ink-2 leading-relaxed">{cluster.description}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-mono">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
