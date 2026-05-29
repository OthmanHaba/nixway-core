import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "CLI · Docs" };

export default function CliDoc() {
  return (
    <DocPage
      eyebrow="Docs · reference"
      title="CLI reference"
      lede="Every command, every flag. The CLI is a single static binary that authenticates against the control plane and stores tokens in the OS keychain."
      prev={{ href: "/docs/guides/self-host", label: "Self-host the control plane" }}
      next={{ href: "/docs/api", label: "HTTP API" }}
    >
      <h2>Install</h2>
      <pre><code>{`brew install nixway/tap/nixway
# or
curl -fsSL https://nixway.dev/install.sh | sh
# or
go install github.com/nixway/cli@latest`}</code></pre>

      <h2>Auth</h2>
      <CmdGroup
        cmds={[
          ["nixway login", "Browser-based OAuth. Stores a token in the OS keychain."],
          ["nixway logout", "Forget the local token."],
          ["nixway whoami", "Print the current user, team, and API endpoint."],
          ["nixway tokens create --name ci --scope deploy", "Mint a scoped API token for automation."],
        ]}
      />

      <h2>Teams</h2>
      <CmdGroup
        cmds={[
          ["nixway teams list", "List teams you belong to."],
          ["nixway teams use orbit", "Switch the active team for subsequent commands."],
          ["nixway teams invite ada@orbit.co --role admin", "Invite a collaborator."],
        ]}
      />

      <h2>Servers</h2>
      <CmdGroup
        cmds={[
          ["nixway servers add NAME --ssh user@host", "Install the agent over SSH and register a server."],
          ["nixway servers list", "List servers with status, region, capacity, agent version."],
          ["nixway servers status NAME", "Live status: heartbeat, workloads, last error."],
          ["nixway servers drain NAME", "Reschedule workloads to other servers and stop accepting new ones."],
          ["nixway servers uncordon NAME", "Resume scheduling onto a drained server."],
          ["nixway servers remove NAME", "Uninstall the agent and forget the server."],
        ]}
      />

      <h2>Clusters</h2>
      <CmdGroup
        cmds={[
          ["nixway clusters create NAME --label key=value", "Create a logical group of servers."],
          ["nixway clusters add-server CLUSTER SERVER", "Attach a server to a cluster."],
          ["nixway clusters list", "List clusters with member count and health."],
        ]}
      />

      <h2>Projects &amp; apps</h2>
      <CmdGroup
        cmds={[
          ["nixway projects create NAME --repo org/repo --branch main", "Create a project and connect a Git repo."],
          ["nixway apps create NAME --project P --path services/api", "Add an app from a sub-path of the project repo."],
          ["nixway env set KEY=value --project P --env staging", "Set a non-secret env var."],
          ["nixway secrets set KEY --project P --env prod --value '...'", "Set an encrypted secret."],
        ]}
      />

      <h2>Deploys</h2>
      <CmdGroup
        cmds={[
          ["nixway deploy --project P --env staging", "Trigger a build and deploy."],
          ["nixway tail APP", "Stream build, deploy, and runtime logs."],
          ["nixway promote APP --from staging --to prod", "Copy the green staging release into prod."],
          ["nixway rollback APP --to vN", "Roll an app back to a prior release."],
          ["nixway releases list APP", "List recent releases with git SHA and status."],
        ]}
      />

      <h2>Databases &amp; volumes</h2>
      <CmdGroup
        cmds={[
          ["nixway databases create NAME --engine postgres --size 10Gi", "Provision a managed database."],
          ["nixway databases backup NAME", "Take an immediate snapshot."],
          ["nixway databases psql NAME", "Open a psql session through the mesh."],
          ["nixway volumes create NAME --size 50Gi --attach APP", "Create and attach a persistent volume."],
        ]}
      />

      <h2>Runtime ops</h2>
      <CmdGroup
        cmds={[
          ["nixway exec APP -- /bin/sh", "Web-terminal-grade exec into a running instance."],
          ["nixway inspect APP", "Pod-level introspection: env, mounts, network, limits."],
          ["nixway logs APP --since 1h", "Search and stream logs."],
          ["nixway restart APP", "Rolling restart of all instances."],
        ]}
      />
    </DocPage>
  );
}

function CmdGroup({ cmds }: { cmds: [string, string][] }) {
  return (
    <div className="my-4 border-t border-line-1">
      {cmds.map(([cmd, body]) => (
        <div
          key={cmd}
          className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-2 sm:gap-6 py-4 border-b border-line-1"
        >
          <code className="font-mono text-[12.5px] text-ink-1 bg-transparent border-0 p-0">{cmd}</code>
          <p className="text-ink-2 text-[13px] leading-relaxed m-0">{body}</p>
        </div>
      ))}
    </div>
  );
}
