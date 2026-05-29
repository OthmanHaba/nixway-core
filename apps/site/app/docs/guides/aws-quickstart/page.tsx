import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "AWS quickstart · Docs" };

export default function AwsQuickstartDoc() {
  return (
    <DocPage
      eyebrow="Docs · guide"
      title="AWS quickstart"
      lede="Deploy Nixway to AWS in 15 minutes. Designed for teams burning AWS Activate credits and procurement teams routing spend through committed AWS budgets."
      prev={{ href: "/docs/concepts/networking", label: "Networking & mesh" }}
      next={{ href: "/docs/guides/self-host", label: "Self-host the control plane" }}
    >
      <h2>What you&rsquo;ll deploy</h2>
      <p>
        A working three-server cluster on AWS: one server as the edge tier
        (Traefik + public ingress), two servers running app workloads. All
        traffic stays inside your VPC.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>An AWS account (Activate, Startups, or regular billing).</li>
        <li>A keypair you can SSH with.</li>
        <li>A registered domain you can add a CNAME to.</li>
        <li>The Nixway CLI installed (see <a href="/docs/getting-started">getting started</a>).</li>
      </ul>

      <h2>1. Provision three EC2 instances</h2>
      <p>
        Anything with 2 vCPU and 4 GB will run a meaningful workload. For
        production we recommend Graviton (<code>t4g.medium</code> or larger):
        same performance per dollar as <code>t3</code>, materially cheaper.
      </p>
      <pre><code>{`# pick an Ubuntu 24.04 LTS AMI in your region
# launch 3 t4g.medium with:
#   - a security group allowing 22, 80, 443 from anywhere
#   - the same keypair on all three`}</code></pre>

      <h2>2. Register all three with Nixway</h2>
      <pre><code>{`nixway servers add aws-edge-01 \\
  --ssh ubuntu@<public-ip-1> --tags edge,public --region us-east-1

nixway servers add aws-app-01 \\
  --ssh ubuntu@<public-ip-2> --tags app --region us-east-1

nixway servers add aws-app-02 \\
  --ssh ubuntu@<public-ip-3> --tags app --region us-east-1`}</code></pre>

      <h2>3. Create a cluster</h2>
      <pre><code>{`nixway clusters create prod-us \\
  --label region=us-east-1 \\
  --label cloud=aws

nixway clusters add-server prod-us aws-edge-01 --role edge
nixway clusters add-server prod-us aws-app-01  --role app
nixway clusters add-server prod-us aws-app-02  --role app`}</code></pre>

      <h2>4. Point DNS at the edge</h2>
      <p>
        Add an A record (or a CNAME) for your platform domain to the public IP
        of <code>aws-edge-01</code>. For wildcard apps:
      </p>
      <pre><code>{`*.apps.your-co.dev   →   <public-ip-of-aws-edge-01>`}</code></pre>

      <h2>5. Deploy</h2>
      <pre><code>{`nixway projects create hello \\
  --repo your-org/hello-world \\
  --branch main \\
  --cluster prod-us

git push origin main
# nixway picks up the webhook, builds, deploys
# live at hello.apps.your-co.dev within ~60s`}</code></pre>

      <h2>AWS-specific recipes</h2>
      <h3>Graviton everywhere</h3>
      <p>
        Add <code>--arch arm64</code> when registering the server. Nixway
        auto-selects buildpack images for the right architecture and builds
        Dockerfiles with <code>--platform linux/arm64</code>.
      </p>

      <h3>RDS-managed Postgres</h3>
      <p>
        Prefer RDS for production Postgres? Skip the Nixway-managed database
        and pass a connection string via secret. The app still gets the
        connection in an env var, and your DBA gets RDS&rsquo;s native
        snapshots.
      </p>
      <pre><code>{`nixway secrets set DATABASE_URL \\
  --project hello --env prod \\
  --value "postgres://orbit:****@orbit-prod.cluster-x.us-east-1.rds.amazonaws.com:5432/orbit"`}</code></pre>

      <h3>S3 for build artifacts and backups</h3>
      <p>
        On the self-hosted control plane, point{" "}
        <code>NIXWAY_PLATFORMSTORAGE_*</code> at an S3 bucket. Backups, build
        artifacts, and logs land in your bucket with your KMS key, billed to
        your account.
      </p>

      <h3>Routing through ALB</h3>
      <p>
        For teams that need WAF, Shield, or existing ALB-based observability,
        run the edge agent behind an Application Load Balancer. Terminate TLS
        at the ALB and forward to the edge agent on port 80.
      </p>

      <h2>Activate-credit checklist</h2>
      <p>
        Reviewers from AWS Activate frequently ask the same handful of
        questions. Here&rsquo;s the short list with our answer:
      </p>
      <ul>
        <li><strong>Does this product drive AWS revenue?</strong> Yes. Nixway runs workloads on the customer&rsquo;s own EC2, EBS, RDS, and S3 spend.</li>
        <li><strong>Are you AWS Marketplace listed?</strong> Listing in progress. Email us if you need the listing fast-tracked.</li>
        <li><strong>Do you support Graviton?</strong> First-class. Auto-detection at build time.</li>
        <li><strong>Do you support private workloads?</strong> Yes. The agent dials out only; no inbound port required.</li>
        <li><strong>Do you offer founder discounts?</strong> Yes. Email <a href="mailto:founders@nixway.dev">founders@nixway.dev</a> with your Activate confirmation.</li>
      </ul>
    </DocPage>
  );
}
