import { AuthHeading } from "@/components/auth/AuthHeading";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata = { title: "Create account · Nixway Core" };

export default function SignupPage() {
  return (
    <>
      <AuthHeading
        eyebrow="Console · provisioning"
        title="Spin up an account."
        subtitle="A team is created automatically. You can invite operators after you sign in."
      />
      <SignupForm />
    </>
  );
}
