import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Clusters & servers · Docs" };

export default function ClustersDoc() {
  return (
    <DocPage
      eyebrow="Docs · concepts"
      title="Clusters & servers"
      lede="Group servers across providers into a single deploy target. Nixway handles placement, replication, and rolling updates."
      prev={{ href: "/docs/concepts/projects", label: "Projects & apps" }}
      next={{ href: "/docs/concepts/deployments", label: "Deployments" }}
    >
      <h2>Servers</h2>
      <p>
        A <strong>server</strong> is any Linux box (kernel 5.4+) that runs the
        Nixway agent. Bare metal, EC2, Hetzner dedicated, Lightsail VMs, Mac
        minis in a closet: anywhere the agent installs, Nixway can deploy.
      </p>

      <h2>Clusters</h2>
      <p>
        A <strong>cluster</strong> is a logical group of servers that share a
        purpose: a region, a tier, a customer tenant, or a workload class.
        Apps target a cluster, not individual servers, and the scheduler picks
        placement based on labels, capacity, and anti-affinity rules.
      </p>
      <pre><code>{`nixway clusters create prod-edge \\
  --label tier=public \\
  --label region=us-east-1

nixway clusters add-server prod-edge fra-edge-01 \\
  --weight 100`}</code></pre>

      <h2>Tags &amp; labels</h2>
      <p>
        Tags categorize servers (<code>edge</code>, <code>db</code>,
        <code>build</code>) and labels carry structured key=value metadata. The
        scheduler honors both, so you can pin database workloads to
        memory-rich boxes and stateless web workloads to anything cheap.
      </p>

      <h2>Status &amp; health</h2>
      <p>
        Every server reports a heartbeat over the reverse-SSH tunnel. The
        agent reports its own version, available capacity, and the state of
        every workload it supervises. The console shows the live status; the
        CLI exposes the same data:
      </p>
      <pre><code>{`nixway servers list

NAME             CLUSTER     STATUS   CPU   MEM   APPS  AGENT
fra-edge-01      prod-edge   online   12%   38%   4     0.4.0
fra-db-01        prod-db     online   42%   71%   2     0.4.0
sgp-edge-01      prod-edge   degraded 88%   91%   4     0.4.0`}</code></pre>

      <h2>Drain &amp; cordon</h2>
      <p>
        Need to take a server out for maintenance? Drain it. Apps reschedule
        onto the rest of the cluster while the box stays connected for
        diagnostics.
      </p>
      <pre><code>{`nixway servers drain fra-edge-01
# … apps reschedule
nixway servers uncordon fra-edge-01`}</code></pre>
    </DocPage>
  );
}
