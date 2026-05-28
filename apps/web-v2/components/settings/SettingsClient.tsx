"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  AtSign,
  BellRing,
  ChevronRight,
  KeyRound,
  LogOut,
  Mail,
  Palette,
  ShieldAlert,
  User as UserIcon,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { authApi, ApiError, type CurrentUser } from "@/lib/api";
import type { Team } from "@/lib/types";

interface Props {
  user: CurrentUser;
  activeTeam: Team | null;
}

export function SettingsClient({ user, activeTeam }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not sign out."),
  });

  return (
    <div className="space-y-6 max-w-[820px]">
      {error && <Alert tone="error">{error}</Alert>}

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 inline-flex items-center gap-2">
            <UserIcon className="h-3 w-3" /> Account
          </div>
          <h2 className="text-[16px] text-ink-1">Profile</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Identity used across this team. Editing comes in the next phase —
            for now, contact an Owner if it&rsquo;s wrong.
          </p>
        </CardHeader>
        <CardBody className="space-y-2">
          <ReadOnlyRow icon={<AtSign className="h-3.5 w-3.5" />} label="Display name">
            {user.name || "—"}
          </ReadOnlyRow>
          <ReadOnlyRow icon={<Mail className="h-3.5 w-3.5" />} label="Email">
            <span className="font-mono text-[12px]">{user.email}</span>
            {user.email_verified ? (
              <Badge tone="online" dot>
                verified
              </Badge>
            ) : (
              <Badge tone="warn">unverified</Badge>
            )}
          </ReadOnlyRow>
        </CardBody>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 inline-flex items-center gap-2">
            <Palette className="h-3 w-3" /> Appearance
          </div>
          <h2 className="text-[16px] text-ink-1">Theme</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Switch between the warm light and deep graphite themes. Stored
            locally in your browser.
          </p>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <span className="font-mono text-[11px] text-ink-3">click to cycle</span>
          </div>
        </CardBody>
      </Card>

      {/* Team shortcuts */}
      {activeTeam && (
        <Card>
          <CardHeader>
            <div className="label-mono mb-1">Workspace</div>
            <h2 className="text-[16px] text-ink-1">
              {activeTeam.name} <span className="font-mono text-ink-3 text-[12px]">/ {activeTeam.slug}</span>
            </h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Per-team configuration lives under the Teams area.
            </p>
          </CardHeader>
          <CardBody className="space-y-1">
            <NavRow
              href={`/teams/${activeTeam.id}/members`}
              icon={<UserIcon className="h-3.5 w-3.5" />}
              label="Members"
              hint="Add, remove, change roles"
            />
            <NavRow
              href={`/teams/${activeTeam.id}/tokens`}
              icon={<KeyRound className="h-3.5 w-3.5" />}
              label="API Tokens"
              hint="Scoped tokens for CI and the CLI"
            />
            <NavRow
              href={`/teams/${activeTeam.id}/secrets`}
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              label="Secrets"
              hint="Environment secrets, injected at deploy time"
            />
            <NavRow
              href={`/teams/${activeTeam.id}/audit-log`}
              icon={<BellRing className="h-3.5 w-3.5" />}
              label="Audit log"
              hint="Every action taken in this team"
            />
          </CardBody>
        </Card>
      )}

      {/* Notifications scaffold */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 inline-flex items-center gap-2">
            <BellRing className="h-3 w-3" /> Notifications
          </div>
          <h2 className="text-[16px] text-ink-1">Channels & subscriptions</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Outbound Slack and webhook channels for build/deploy/scale/rotation
            events. Wiring up in a future phase.
          </p>
        </CardHeader>
        <CardBody>
          <Badge tone="outline">coming soon</Badge>
        </CardBody>
      </Card>

      {/* Sign out */}
      <Card>
        <CardBody className="flex items-center justify-between gap-3 py-4">
          <div>
            <div className="label-mono mb-0.5 inline-flex items-center gap-2">
              <LogOut className="h-3 w-3" /> Session
            </div>
            <p className="text-[12px] text-ink-3">
              Ends the current session on this device. You&rsquo;ll need to log in again.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => logout.mutate()}
            loading={logout.isPending}
            className="text-alert"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function ReadOnlyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-line-1 last:border-b-0">
      <div className="inline-flex items-center gap-2 label-mono">
        <span className="text-ink-3">{icon}</span>
        {label}
      </div>
      <div className="flex items-center gap-2 text-ink-1 text-[13px]">{children}</div>
    </div>
  );
}

function NavRow({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-2 py-2 -mx-2 rounded-[var(--radius-sm)] hover:bg-surface-2 transition-colors group"
    >
      <span className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] border border-line-1 bg-surface-1 text-ink-3 group-hover:text-ink-1 transition-colors shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-ink-1">{label}</div>
        <div className="text-[11px] text-ink-3">{hint}</div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-ink-4 group-hover:text-signal transition-colors shrink-0" />
    </Link>
  );
}
