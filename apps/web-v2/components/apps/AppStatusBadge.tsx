import { Badge } from "@/components/primitives/Badge";

const TONE: Record<string, "online" | "warn" | "alert" | "neutral" | "info"> = {
  active:    "online",
  deploying: "info",
  building:  "info",
  paused:    "warn",
  error:     "alert",
};

export function AppStatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? "neutral";
  return (
    <Badge tone={tone} dot>
      {status}
    </Badge>
  );
}
