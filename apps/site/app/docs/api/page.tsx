import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "HTTP API · Docs" };

export default function ApiDoc() {
  return (
    <DocPage
      eyebrow="Docs · reference"
      title="HTTP API"
      lede="A RESTful API for everything you can do in the console or CLI. JSON in, JSON out. Bearer-token auth. Stable per major version."
      prev={{ href: "/docs/cli", label: "CLI" }}
    >
      <h2>Base URL</h2>
      <pre><code>{`https://api.nixway.dev/v1
# self-hosted:
https://<your-control-plane>/api/v1`}</code></pre>

      <h2>Auth</h2>
      <p>
        All requests require a bearer token in the <code>Authorization</code>
        header. Tokens are minted via <code>nixway tokens create</code> or in
        the console under <strong>Settings → API Tokens</strong>. Scopes are
        token-level; revocation is immediate.
      </p>
      <pre><code>{`curl https://api.nixway.dev/v1/teams \\
  -H "Authorization: Bearer $NIXWAY_TOKEN"`}</code></pre>

      <h2>Pagination</h2>
      <p>
        List endpoints accept <code>page</code> and <code>page_size</code> (max
        200). Responses include a <code>next_page</code> token when more
        records are available.
      </p>

      <h2>Errors</h2>
      <pre><code>{`{
  "error": {
    "code": "not_found",
    "message": "server fra-edge-99 not found in team orbit",
    "request_id": "req_01J5MZP3QH9X8VT0YH2EAYG6FT"
  }
}`}</code></pre>
      <p>
        Always log <code>request_id</code>. It correlates every layer of the
        control plane and is the first thing support will ask for.
      </p>

      <h2>Selected endpoints</h2>
      <pre><code>{`GET    /v1/teams
GET    /v1/teams/{team_id}/servers
POST   /v1/teams/{team_id}/servers
GET    /v1/teams/{team_id}/clusters
GET    /v1/teams/{team_id}/projects
POST   /v1/projects/{project_id}/apps
POST   /v1/apps/{app_id}/deploy
GET    /v1/apps/{app_id}/releases
POST   /v1/apps/{app_id}/rollback
GET    /v1/apps/{app_id}/logs            (Server-Sent Events)
POST   /v1/secrets
GET    /v1/teams/{team_id}/audit-logs`}</code></pre>

      <h2>Webhooks</h2>
      <p>
        Configure outbound webhooks per team. Nixway POSTs a signed JSON
        payload for the events you subscribe to: <code>deploy.started</code>,{" "}
        <code>deploy.succeeded</code>, <code>deploy.failed</code>,{" "}
        <code>release.promoted</code>, <code>server.degraded</code>,{" "}
        <code>secret.revealed</code>.
      </p>
      <pre><code>{`POST https://your-app/webhooks/nixway

X-Nixway-Event: deploy.succeeded
X-Nixway-Signature: t=1716998822,v1=8e9c1c...
Content-Type: application/json

{
  "event": "deploy.succeeded",
  "team_id": "team_01J5...",
  "app_id": "app_01J5...",
  "release_id": "rel_v124",
  "duration_ms": 38112
}`}</code></pre>

      <h2>OpenAPI</h2>
      <p>
        The full machine-readable spec lives at{" "}
        <code>/api/openapi.json</code> on every control plane. Generate
        clients with <a href="https://openapi-generator.tech/">openapi-generator</a>{" "}
        or any spec-compatible tool.
      </p>
    </DocPage>
  );
}
