import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Deployments · Docs" };

export default function DeploymentsDoc() {
  return (
    <DocPage
      eyebrow="Docs · concepts"
      title="Deployments"
      lede="The deploy pipeline: build, push, route, health-check, retire. Every step is observable, retryable, and reversible."
      prev={{ href: "/docs/concepts/clusters", label: "Clusters & servers" }}
      next={{ href: "/docs/concepts/networking", label: "Networking & mesh" }}
    >
      <h2>The pipeline</h2>
      <ol>
        <li><strong>Trigger</strong> A push, a webhook, or a manual <code>nixway deploy</code>.</li>
        <li><strong>Build</strong> Buildpack or Dockerfile, with shared cache per project.</li>
        <li><strong>Push</strong> Image lands in the per-team internal registry.</li>
        <li><strong>Plan</strong> Scheduler picks target servers and a rollout strategy.</li>
        <li><strong>Apply</strong> Agents pull and start the new revision in batches.</li>
        <li><strong>Verify</strong> Health checks must pass before each batch advances.</li>
        <li><strong>Route</strong> Traefik shifts traffic; old revision drains.</li>
        <li><strong>Retire</strong> Old revision shuts down after the grace window.</li>
      </ol>

      <h2>Build configuration</h2>
      <p>
        For buildpack apps, configure runtime version and start command in{" "}
        <code>nixway.toml</code>:
      </p>
      <pre><code>{`# nixway.toml
[build]
buildpack = "auto"        # or "node", "go", "python", …

[runtime]
command = "bun start"
port    = 3000
healthcheck = "/healthz"

[env.staging]
LOG_LEVEL = "debug"

[env.prod]
LOG_LEVEL = "info"`}</code></pre>

      <h2>Rollout strategies</h2>
      <ul>
        <li><strong>Rolling</strong> (default) Replaces instances batch by batch, honoring health checks.</li>
        <li><strong>Canary</strong> Sends a percentage of traffic to the new revision before full rollout.</li>
        <li><strong>Blue-green</strong> Stands the new revision up beside the old, then atomically swaps.</li>
      </ul>

      <h2>Rollback</h2>
      <p>
        Every release is content-addressed and retained for 90 days by
        default. Rollback is a single command:
      </p>
      <pre><code>{`nixway releases list orbit-api

ID         CREATED              STATUS   GIT SHA
v124       2026-05-29 14:02     live     a1c8e02
v123       2026-05-29 09:18     retired  e4dd711

nixway rollback orbit-api --to v123
# traffic shifts back in < 5s`}</code></pre>

      <h2>Health checks</h2>
      <p>
        Every app defines an HTTP health check. The agent verifies it before
        promoting a release into the routing pool and continues to probe at
        runtime. Three consecutive failures triggers a restart; ten in a row
        marks the revision unhealthy and pages oncall.
      </p>
    </DocPage>
  );
}
