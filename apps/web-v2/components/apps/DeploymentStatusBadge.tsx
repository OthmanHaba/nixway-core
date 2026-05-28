import { Badge } from "@/components/primitives/Badge";
import type { DeploymentStatus } from "@/lib/types";

const TONE: Record<string, "online" | "info" | "warn" | "alert" | "neutral"> = {
  healthy:     "online",
  deploying:   "info",
  pending:     "neutral",
  degraded:    "warn",
  failed:      "alert",
  rolled_back: "warn",
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <Badge tone={TONE[status] ?? "neutral"} dot>
      {status}
    </Badge>
  );
}
