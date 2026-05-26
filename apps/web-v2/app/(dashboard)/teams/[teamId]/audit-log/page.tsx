import { Activity } from "lucide-react";
import { EmptyState } from "@/components/primitives/EmptyState";

export const metadata = { title: "Audit Log · Nixway Core" };

export default function AuditLogPage() {
  return (
    <EmptyState
      icon={<Activity className="h-4 w-4" />}
      title="Audit log — coming in 2c"
      body="Every operator action against this team, with filters by actor, action, and resource. Cursor-paginated, exportable."
    />
  );
}
