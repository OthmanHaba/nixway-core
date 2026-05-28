import { AuthHeading } from "@/components/auth/AuthHeading";
import { ResetForm } from "@/components/auth/ResetForm";

export const metadata = { title: "Set passphrase · Nixway Core" };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <AuthHeading
        eyebrow="Console · recovery"
        title="Set a new key."
        subtitle="Choose a fresh passphrase. Existing sessions on other devices will be revoked."
      />
      <ResetForm token={token} />
    </>
  );
}
