import { Badge } from "@/components/primitives/Badge";
import type { ClusterStatus } from "@/lib/types";

const TONE: Record<ClusterStatus, "online" | "warn" | "alert" | "info"> = {
  active:       "online",
  provisioning: "info",
  degraded:     "warn",
  error:        "alert",
};

export function ClusterStatusBadge({ status }: { status: ClusterStatus | string }) {
  const known = (["active", "degraded", "error", "provisioning"] as const).includes(
    status as ClusterStatus,
  );
  const key = (known ? status : "active") as ClusterStatus;
  return (
    <Badge tone={TONE[key]} dot>
      {key}
    </Badge>
  );
}
