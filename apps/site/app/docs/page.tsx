import Link from "next/link";
import type { Metadata } from "next";
import {
  Rocket,
  Network,
  Boxes,
  Server,
  Cloud,
  ShieldCheck,
  Terminal,
  Plug,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Documentation for Nixway Core. Getting started, architecture, concepts, guides, CLI and HTTP API reference.",
};

const TOPICS = [
  {
    h: "Get started in 10 minutes",
    items: [
      { icon: Rocket, href: "/docs/getting-started", t: "Getting started", b: "Install the CLI, register a server, deploy your first app." },
      { icon: Network, href: "/docs/architecture", t: "Architecture", b: "How the control plane, agents, and the private mesh fit together." },
    ],
  },
  {
    h: "Concepts",
    items: [
      { icon: Boxes, href: "/docs/concepts/projects", t: "Projects & apps", b: "The unit of deployment. Environments, branches, and releases." },
      { icon: Server, href: "/docs/concepts/clusters", t: "Clusters & servers", b: "Group servers across providers into a single deploy target." },
      { icon: Rocket, href: "/docs/concepts/deployments", t: "Deployments", b: "Buildpacks, Dockerfiles, health checks, rollbacks, and promotion." },
      { icon: Network, href: "/docs/concepts/networking", t: "Networking & mesh", b: "Private overlay, internal DNS, public routing, and TLS." },
    ],
  },
  {
    h: "Guides",
    items: [
      { icon: Cloud, href: "/docs/guides/aws-quickstart", t: "AWS quickstart", b: "Deploy to EC2 or Lightsail. Activate-credit friendly." },
      { icon: ShieldCheck, href: "/docs/guides/self-host", t: "Self-host the control plane", b: "Run the whole platform on one Docker Compose file." },
    ],
  },
  {
    h: "Reference",
    items: [
      { icon: Terminal, href: "/docs/cli", t: "CLI", b: "Every command, every flag, copy-paste ready." },
      { icon: Plug, href: "/docs/api", t: "HTTP API", b: "OpenAPI surface, auth, pagination, webhooks." },
    ],
  },
];

export default function DocsIndexPage() {
  return (
    <div className="max-w-[920px] mx-auto px-6 sm:px-10 py-14">
      <div className="label-mono mb-3">Documentation</div>
      <h1 className="font-display italic text-5xl text-ink-1 leading-[1.05]">
        Operate the platform.
      </h1>
      <p className="mt-5 text-ink-2 text-[16px] leading-relaxed max-w-[60ch]">
        Everything you need to ship workloads on Nixway, from the first deploy
        to the moment you self-host the whole platform inside your own VPC.
      </p>

      <div className="mt-12 space-y-12">
        {TOPICS.map((sec) => (
          <section key={sec.h}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3 mb-4">
              {sec.h}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sec.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="group rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-5 hover:border-line-2 hover:bg-surface-2 transition-colors"
                >
                  <div className="flex items-center gap-2 text-signal mb-3">
                    <it.icon className="h-3.5 w-3.5" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 group-hover:text-ink-2">
                      Open
                    </span>
                  </div>
                  <div className="text-ink-1 text-[15px] font-medium">{it.t}</div>
                  <p className="mt-1.5 text-ink-3 text-[13px] leading-relaxed">{it.b}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
