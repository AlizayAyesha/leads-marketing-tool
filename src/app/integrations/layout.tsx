import Link from "next/link";

import { socialAutomationEnabled } from "@/lib/features";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/integrations", label: "Connected Services" },
  { href: "/integrations/actors", label: "Apify Actors" },
  { href: "/integrations/scraping", label: "Elite Lead Engine" },
  { href: "/integrations/sheets", label: "Google Sheets" },
  { href: "/integrations/ai", label: "AI Providers" },
  { href: "/integrations/browser", label: "Chrome", socialSend: true },
  { href: "/integrations/linkedin", label: "LinkedIn Send", socialSend: true },
  { href: "/integrations/keys", label: "API Keys" },
];

export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <IntegrationsNav />
      {children}
    </div>
  );
}

function IntegrationsNav() {
  const social = socialAutomationEnabled();
  const visible = tabs.filter((tab) => social || !tab.socialSend);
  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {visible.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "rounded-full border border-emerald-500/15 px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-muted hover:border-emerald-400/40 hover:text-white",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
