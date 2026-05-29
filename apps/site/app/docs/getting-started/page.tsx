import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Getting started · Docs" };

export default function GettingStarted() {
  return (
    <DocPage
      eyebrow="Docs · start"
      title="Getting started"
      lede="From zero to a live URL in ten minutes. Install the CLI, register your first server, deploy an app, and watch the rollout."
      next={{ href: "/docs/architecture", label: "Architecture" }}
    >
      <h2>1. Install the CLI</h2>
      <p>
        The Nixway CLI is a single static binary. Install it via Homebrew on
        macOS, the install script on Linux, or the prebuilt download on Windows.
      </p>
      <pre><code>{`brew install nixway/tap/nixway
# or
curl -fsSL https://nixway.dev/install.sh | sh`}</code></pre>
      <p>Verify the install:</p>
      <pre><code>{`nixway --version`}</code></pre>

      <h2>2. Sign in</h2>
      <p>
        Create a free account at <a href="/pricing">nixway.dev</a> or self-host the
        control plane (see the{" "}
        <a href="/docs/guides/self-host">self-host guide</a>). Then log in from
        the CLI:
      </p>
      <pre><code>{`nixway login
# opens your browser, returns with a token stored in the OS keychain`}</code></pre>

      <h2>3. Register a server</h2>
      <p>
        Bring any Linux box. The agent installer runs over SSH and finishes in
        under a minute on a fresh VM.
      </p>
      <pre><code>{`nixway servers add fra-edge-01 \\
  --ssh ubuntu@5.75.198.42 \\
  --region fra-1 \\
  --tags edge,public`}</code></pre>
      <p>
        Watch the agent install and report ready:
      </p>
      <pre><code>{`nixway servers status fra-edge-01

NAME             REGION   STATUS   AGENT   UPTIME
fra-edge-01      fra-1    online   0.4.0   00:00:42`}</code></pre>

      <h2>4. Create a project</h2>
      <p>
        A <strong>project</strong> groups one or more apps that share secrets,
        domains, and environments. Connect a GitHub repo and pick a branch per
        environment.
      </p>
      <pre><code>{`nixway projects create orbit-api \\
  --repo orbit/api \\
  --branch main`}</code></pre>

      <h2>5. Deploy</h2>
      <p>
        Push the branch. Nixway picks up the webhook, builds the image,
        publishes it to the internal registry, and rolls it out across the
        servers tagged for this environment.
      </p>
      <pre><code>{`git push origin main
nixway tail orbit-api

→ build · cache HIT (87%)
→ push  · 18.4 MB
→ deploy · 3/3 servers green
✓ orbit-api · v124 live at orbit-api.apps.orbit.co`}</code></pre>

      <h2>What just happened</h2>
      <ul>
        <li>The control plane received the GitHub webhook and queued a build.</li>
        <li>A worker built the image using buildpack auto-detection (or your Dockerfile).</li>
        <li>The image landed in the per-team internal registry, content-addressed.</li>
        <li>The agent on each target server pulled the image and started the new revision.</li>
        <li>Traefik issued a TLS certificate and routed the new public hostname.</li>
        <li>Health checks went green and the old revision was retired.</li>
      </ul>

      <h2>Next steps</h2>
      <ul>
        <li>Add a Postgres: <code>nixway databases create orbit-db --engine postgres</code></li>
        <li>Promote to production: <code>nixway promote orbit-api --env prod</code></li>
        <li>Read about <a href="/docs/architecture">how the control plane talks to your servers</a></li>
        <li>Wire up <a href="/docs/concepts/networking">private mesh networking</a> across regions</li>
      </ul>
    </DocPage>
  );
}
