import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-emerald-400/80">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-[family-name:var(--font-syne)] text-3xl tracking-tight glow-text">
          {title}
        </h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  marks,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  marks?: string[];
}) {
  const card = (
    <div className="glass h-full rounded-2xl p-4 transition hover:border-emerald-400/30">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 font-[family-name:var(--font-syne)] text-3xl text-emerald-100">{value}</p>
      {hint ? <p className="mt-1 text-xs text-emerald-200/90">{hint}</p> : null}
      {marks?.length ? (
        <p className="mt-2 text-[11px] text-muted">{marks.map((mark) => `✓ ${mark}`).join(" · ")}</p>
      ) : null}
    </div>
  );
  if (!href) return card;
  return (
    <Link href={href} className="block">
      {card}
    </Link>
  );
}

export function EmptyState({
  title,
  description,
  className,
}: HTMLAttributes<HTMLDivElement> & { title: string; description: string }) {
  return (
    <div className={cn("glass rounded-2xl px-6 py-12 text-center", className)}>
      <p className="font-[family-name:var(--font-syne)] text-lg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
    </div>
  );
}
