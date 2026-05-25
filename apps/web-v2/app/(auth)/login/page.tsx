import { AuthHeading } from "@/components/auth/AuthHeading";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Sign in · Nixway Core" };

export default function LoginPage() {
  return (
    <>
      <AuthHeading
        eyebrow="Console · sign in"
        title="Welcome back."
        subtitle="Authenticate to enter mission control. Cookies stay on this device — sessions roll automatically after sixty days of inactivity."
      />
      <LoginForm />
    </>
  );
}
