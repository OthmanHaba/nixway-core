import { Settings as SettingsIcon } from "lucide-react";
import { EmptyState } from "@/components/primitives/EmptyState";

export const metadata = { title: "Team Settings · Nixway Core" };

export default function SettingsPage() {
  return (
    <EmptyState
      icon={<SettingsIcon className="h-4 w-4" />}
      title="Team settings — coming in 2c"
      body="Rename the team, delete it, and configure platform-level defaults."
    />
  );
}
