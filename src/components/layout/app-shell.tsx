"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  LayoutDashboard,
  Plug,
  Radar,
  Settings,
  Users,
  ChartNoAxesCombined,
} from "lucide-react";

import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/integrations/scraping", label: "Elite Scraper", icon: Radar },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/outreach", label: "Approvals", icon: Inbox },
  { href: "/analytics", label: "Results", icon: ChartNoAxesCombined },
  { href: "/integrations", label: "Connect", icon: Plug },
  { href: "/settings/business", label: "Business Profile", icon: Settings },
  { href: "/settings/senders", label: "Sender inboxes", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-emerald-500/10 bg-black/30 p-5 lg:flex">
        <Link href="/" className="mb-8 block">
          <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/80">Leads Marketing Tool</p>
          <p className="font-[family-name:var(--font-syne)] text-2xl leading-none glow-text">JARVIS</p>
          <p className="mt-1 text-xs text-muted">Find · Send · Track</p>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  active
                    ? "bg-emerald-500/15 text-emerald-100"
                    : "text-zinc-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3 text-xs text-muted">
          Daily work lives on <span className="text-emerald-200">Home</span>. Other pages are detail and setup.
        </p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-emerald-500/10 px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between">
            <Link href="/" className="font-[family-name:var(--font-syne)] text-lg">
              JARVIS
            </Link>
            <Link href="/leads" className="text-sm text-emerald-300">
              Leads
            </Link>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 text-xs">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-muted hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
