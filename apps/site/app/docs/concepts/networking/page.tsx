import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Networking & mesh · Docs" };

export default function NetworkingDoc() {
  return (
    <DocPage
      eyebrow="Docs · concepts"
      title="Networking & mesh"
      lede="A private overlay binds your servers across providers and regions. Internal DNS resolves like one flat namespace. Public routing terminates at the edge."
      prev={{ href: "/docs/concepts/deployments", label: "Deployments" }}
      next={{ href: "/docs/guides/aws-quickstart", label: "AWS quickstart" }}
    >
      <h2>The private mesh</h2>
      <p>
        When you join a server to a cluster, the agent negotiates a private
        overlay connection with every other server in the same project. The
        overlay uses a WireGuard-style transport: UDP, modern crypto, zero
        plaintext on the wire.
      </p>
      <p>
        Apps treat the mesh as one flat L3 network. A service in Frankfurt can
        call a database in Singapore using a private hostname, encrypted
        end-to-end, without traversing the public internet.
      </p>

      <h2>Internal DNS</h2>
      <p>
        Every app and database gets an internal hostname:
      </p>
      <pre><code>{`orbit-api.internal       → all healthy instances, round-robin
orbit-api.fra-1.internal → instances in fra-1 only
orbit-db.internal        → primary writer
orbit-db.replica.internal→ read replicas, round-robin`}</code></pre>
      <p>
        Internal DNS is authoritative inside the mesh and never leaks to
        public resolvers.
      </p>

      <h2>Public routing</h2>
      <p>
        Inbound public traffic terminates at the <strong>edge tier</strong>:
        servers tagged <code>edge</code> that run Traefik with Let&rsquo;s
        Encrypt. Add a hostname to an app and Traefik claims a certificate,
        configures the route, and starts forwarding within seconds.
      </p>
      <pre><code>{`nixway domains add orbit-api \\
  --host api.orbit.co

# DNS check, ACME challenge, certificate, route
# all handled automatically. Watch with:
nixway tail orbit-api --filter routing`}</code></pre>

      <h2>Bring your own DNS</h2>
      <p>
        For custom domains, point a CNAME (or an A record) at the edge tier
        for your cluster. For platform domains like <code>apps.your-co.dev</code>,
        delegate the zone to Nixway and we manage records automatically.
      </p>

      <h2>Egress &amp; static IPs</h2>
      <p>
        Outbound traffic exits via the server it originates on. Need a stable
        egress IP for partner integrations? Pin the app to a server with a
        dedicated elastic IP, or route egress through a NAT instance in your
        VPC. Both patterns are documented in the AWS quickstart.
      </p>
    </DocPage>
  );
}
