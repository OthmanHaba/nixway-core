import { Badge } from "@/components/primitives/Badge";
import type { DeploymentStatus } from "@/lib/types";

const TONE: Record<string, "online" | "info" | "warn" | "alert" | "neutral"> = {
  healthy:     "online",
  deploying:   "info",
  pending:     "neutral",
  degraded:    "warn",
  failed:      "alert",
  rolled_back: "warn",
  superseded:  "neutral",
  archived:    "neutral",
};

const LABEL: Record<string, string> = {
  rolled_back: "rolled back",
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <Badge tone={TONE[status] ?? "neutral"} dot>
      {LABEL[status] ?? status}
    </Badge>
  );
}
