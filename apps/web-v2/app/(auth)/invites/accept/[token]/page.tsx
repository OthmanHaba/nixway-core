import { AuthHeading } from "@/components/auth/AuthHeading";
import { AcceptInviteClient } from "@/components/auth/AcceptInviteClient";

export const metadata = { title: "Accept invite · Nixway Core" };

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <AuthHeading eyebrow="Console · invitation" title="Join the team." />
      <AcceptInviteClient token={token} />
    </>
  );
}
