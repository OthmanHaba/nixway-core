/* "Runs on" strip — logos only, no industry labels. Uses Simple Icons CDN
   so we don't ship hand-rolled SVG paths. Single-color so the strip stays
   visually quiet against the page accent. */

const LOGOS = [
  { slug: "amazonaws", name: "AWS" },
  { slug: "hetzner", name: "Hetzner" },
  { slug: "digitalocean", name: "DigitalOcean" },
  { slug: "cloudflare", name: "Cloudflare" },
  { slug: "docker", name: "Docker" },
  { slug: "postgresql", name: "PostgreSQL" },
  { slug: "redis", name: "Redis" },
  { slug: "github", name: "GitHub" },
];

export function RunsOn() {
  return (
    <section className="border-b border-line-1 bg-surface-0">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-10">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="label-mono whitespace-nowrap">
            Runs on the cloud you already pay for
          </div>
          <div className="flex-1 h-px bg-line-1 hidden md:block" />
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-x-6 gap-y-5 items-center">
            {LOGOS.map((l) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={l.slug}
                src={`https://cdn.simpleicons.org/${l.slug}/9a9892`}
                alt={l.name}
                className="h-5 w-auto opacity-80 hover:opacity-100 transition-opacity"
                loading="lazy"
                width={20}
                height={20}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
