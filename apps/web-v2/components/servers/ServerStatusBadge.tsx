import { Badge } from "@/components/primitives/Badge";
import type { ServerStatus } from "@/lib/types";

const TONE: Record<ServerStatus, "online" | "warn" | "alert" | "info" | "neutral"> = {
  online:       "online",
  provisioning: "info",
  degraded:     "warn",
  offline:      "alert",
  unknown:      "neutral",
};

export function ServerStatusBadge({ status }: { status: ServerStatus | string }) {
  const key = (["online", "offline", "degraded", "provisioning", "unknown"] as const).includes(
    status as ServerStatus,
  )
    ? (status as ServerStatus)
    : ("unknown" as ServerStatus);
  return (
    <Badge tone={TONE[key]} dot>
      {key}
    </Badge>
  );
}
