import type { ReactNode } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { requireGuest } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  await requireGuest();
  return <AuthFrame>{children}</AuthFrame>;
}
