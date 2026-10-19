import Link from "next/link";

const TASKS = [
  {
    href: "/integrations/scraping",
    title: "Elite Scraper",
    detail: "Full Elite Lead Engine — Maps actors, Firecrawl, ecosystems, scrape jobs.",
  },
  {
    href: "/leads",
    title: "Leads",
    detail: "Everyone in the database — open a file, research, or suppress.",
  },
  {
    href: "/outreach",
    title: "Approvals & status",
    detail: "Email drafts, kill switch, LinkedIn / X daily toggles. Send from Home.",
  },
  {
    href: "/integrations",
    title: "Connections",
    detail: "Chrome, Sheets, Apify, OpenAI keys.",
  },
];

export function HomeDirectory() {
  return (
    <section className="mb-8">
      <h2 className="mb-1 font-[family-name:var(--font-syne)] text-lg">More</h2>
      <p className="mb-3 text-sm text-muted">Detail pages. Daily send stays on Home.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TASKS.map((item) => (
          <Link key={item.href} href={item.href} className="glass rounded-2xl p-4 hover:border-emerald-400/30">
            <p className="text-sm text-white">{item.title}</p>
            <p className="mt-1 text-xs text-muted">{item.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
