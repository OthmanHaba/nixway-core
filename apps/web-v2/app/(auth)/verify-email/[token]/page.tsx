import { AuthHeading } from "@/components/auth/AuthHeading";
import { VerifyClient } from "@/components/auth/VerifyClient";

export const metadata = { title: "Verify email · Nixway Core" };

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <AuthHeading eyebrow="Console · verification" title="One moment." />
      <VerifyClient token={token} />
    </>
  );
}
