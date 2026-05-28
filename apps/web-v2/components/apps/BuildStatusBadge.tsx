import { Badge } from "@/components/primitives/Badge";
import type { BuildStatus } from "@/lib/types";

const TONE: Record<string, "online" | "info" | "warn" | "alert" | "neutral"> = {
  built:     "online",
  building:  "info",
  cloning:   "info",
  pending:   "neutral",
  failed:    "alert",
  cancelled: "warn",
};

export function BuildStatusBadge({ status }: { status: BuildStatus }) {
  return (
    <Badge tone={TONE[status] ?? "neutral"} dot>
      {status}
    </Badge>
  );
}
