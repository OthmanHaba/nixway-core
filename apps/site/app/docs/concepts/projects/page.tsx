import type { Metadata } from "next";
import { DocPage } from "@/components/docs/DocPage";

export const metadata: Metadata = { title: "Projects & apps · Docs" };

export default function ProjectsDoc() {
  return (
    <DocPage
      eyebrow="Docs · concepts"
      title="Projects & apps"
      lede="A project is a deployable unit of work. Apps live inside projects and share secrets, domains, and environments."
      prev={{ href: "/docs/architecture", label: "Architecture" }}
      next={{ href: "/docs/concepts/clusters", label: "Clusters & servers" }}
    >
      <h2>The hierarchy</h2>
      <pre><code>{`team
└── project (orbit)
    ├── env (staging, prod)
    ├── app (orbit-api)
    │   └── release (v124, v125, …)
    ├── app (orbit-web)
    └── database (orbit-db)`}</code></pre>

      <h2>Projects</h2>
      <p>
        A project owns its Git connection, its environments, its domains, and
        its secrets. Apps inside a project share that surface area, so you can
        wire <code>orbit-web</code> to talk to <code>orbit-api.internal</code>
        without copying configuration around.
      </p>

      <h2>Environments</h2>
      <p>
        Every project gets two environments by default (<code>staging</code>
        and <code>prod</code>) and you can add more. An environment maps a Git
        branch to a target cluster and a domain. Secrets are scoped per
        environment, so a staging key never reaches production.
      </p>

      <h2>Apps</h2>
      <p>
        An app is a runnable workload, typically one repo or one folder inside
        a monorepo. Nixway supports three flavors out of the box:
      </p>
      <ul>
        <li><strong>Buildpacks</strong> for Node, Bun, Go, Python, Rust, Ruby, Java, and Elixir. Auto-detected from the repo.</li>
        <li><strong>Dockerfile</strong> for anything else. We respect your build args, secrets, and target stage.</li>
        <li><strong>Static</strong> for prebuilt SPAs, content sites, and asset pipelines.</li>
      </ul>

      <h2>Releases</h2>
      <p>
        Every deploy produces a <strong>release</strong>, an immutable
        snapshot of the image, the env vars, the secrets manifest, and the
        config. Promoting between environments is a release-to-release copy,
        not a rebuild. Rollbacks point at a prior release ID.
      </p>

      <h2>Common workflow</h2>
      <pre><code>{`# create a project from an existing repo
nixway projects create orbit --repo orbit/monorepo --branch main

# add an app from a sub-path with a Dockerfile
nixway apps create orbit-api \\
  --project orbit \\
  --path services/api \\
  --dockerfile Dockerfile

# add a static site
nixway apps create orbit-web \\
  --project orbit \\
  --path apps/web \\
  --static dist

# promote a green release from staging to prod
nixway promote orbit-api --from staging --to prod`}</code></pre>
    </DocPage>
  );
}
