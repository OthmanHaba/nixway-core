import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { ResendVerifyClient } from "@/components/auth/ResendVerifyClient";

export const metadata = { title: "Check your email · Nixway Core" };

export default function VerifyEmailLandingPage() {
  return (
    <>
      <AuthHeading
        eyebrow="Console · verification"
        title="Check your email."
        subtitle="We sent a verification link to your inbox. It expires in 24 hours. Didn't get it? Resend below."
      />
      <Suspense fallback={null}>
        <ResendVerifyClient />
      </Suspense>
    </>
  );
}
