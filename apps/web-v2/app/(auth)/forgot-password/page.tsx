import { AuthHeading } from "@/components/auth/AuthHeading";
import { ForgotForm } from "@/components/auth/ForgotForm";

export const metadata = { title: "Reset passphrase · Nixway Core" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        eyebrow="Console · recovery"
        title="Lost the keys?"
        subtitle="Enter your operator email and we'll send a reset link. The token is single-use and expires after thirty minutes."
      />
      <ForgotForm />
    </>
  );
}
