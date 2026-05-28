import { Badge } from "@/components/primitives/Badge";
import type { ServerRole } from "@/lib/types";

const TONE: Record<ServerRole, "info" | "warn" | "neutral"> = {
  worker: "neutral",
  edge:   "info",
  both:   "warn",
};

const LABEL: Record<ServerRole, string> = {
  worker: "worker",
  edge:   "edge",
  both:   "edge+worker",
};

export function ServerRoleBadge({ role }: { role: ServerRole | string }) {
  const key = (["worker", "edge", "both"] as const).includes(role as ServerRole)
    ? (role as ServerRole)
    : ("worker" as ServerRole);
  return <Badge tone={TONE[key]}>{LABEL[key]}</Badge>;
}
