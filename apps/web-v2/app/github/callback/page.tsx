"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { githubApi, ApiError } from "@/lib/api";

/**
 * Landing page for the GitHub App manifest flow. After the operator creates the
 * app on GitHub, GitHub redirects here with a one-time `code`. We exchange it
 * for the app credentials (scoped to the team stashed in localStorage before
 * the redirect) and bounce back to the integrations panel.
 */
export default function GitHubCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React strict-mode double-invoke
    ran.current = true;

    const code = new URLSearchParams(window.location.search).get("code");
    const teamId = localStorage.getItem("nixway_github_team_id");

    if (!code) {
      setStatus("error");
      setError("No code received from GitHub.");
      return;
    }
    if (!teamId) {
      setStatus("error");
      setError("Team context was lost. Start again from Integrations.");
      return;
    }

    githubApi
      .callback(teamId, code)
      .then(() => {
        localStorage.removeItem("nixway_github_team_id");
        setStatus("success");
        setTimeout(() => router.push("/integrations"), 1500);
      })
      .catch((e) => {
        setStatus("error");
        setError(e instanceof ApiError ? e.message : "Failed to connect the GitHub App.");
      });
  }, [router]);

  return (
    <div className="min-h-screen grid place-items-center bg-surface-0 px-6">
      <div className="text-center space-y-4 max-w-sm">
        {status === "loading" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-ink-3 mx-auto" />
            <h1 className="text-[16px] text-ink-1">Connecting GitHub App…</h1>
            <p className="text-[12px] text-ink-3">Exchanging credentials with GitHub.</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-[color:var(--online)] mx-auto" />
            <h1 className="text-[16px] text-ink-1">GitHub App connected</h1>
            <p className="text-[12px] text-ink-3">Redirecting to Integrations…</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-10 w-10 text-alert mx-auto" />
            <h1 className="text-[16px] text-ink-1">Connection failed</h1>
            <p className="text-[12px] text-ink-3">{error}</p>
            <Button variant="secondary" onClick={() => router.push("/integrations")}>
              Back to Integrations
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
