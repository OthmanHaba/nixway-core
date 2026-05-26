import { KeyRound } from "lucide-react";
import { EmptyState } from "@/components/primitives/EmptyState";

export const metadata = { title: "API Tokens · Nixway Core" };

export default function TokensPage() {
  return (
    <EmptyState
      icon={<KeyRound className="h-4 w-4" />}
      title="API tokens — coming in 2c"
      body="Create scoped tokens for CI, automation, and external services. One-time reveal, full scope grid, instant revocation."
    />
  );
}
