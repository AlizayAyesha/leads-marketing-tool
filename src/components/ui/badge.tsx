import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  HOT: "bg-rose-500/15 text-rose-300 border-rose-400/20",
  WARM: "bg-amber-500/15 text-amber-200 border-amber-400/20",
  COLD: "bg-cyan-500/10 text-cyan-200 border-cyan-400/20",
  DISQUALIFIED: "bg-white/5 text-zinc-400 border-white/10",
  default: "bg-emerald-500/10 text-emerald-200 border-emerald-400/20",
  muted: "bg-white/5 text-muted border-white/10",
};

export function Badge({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tones[tone] ?? tones.default,
        className,
      )}
      {...props}
    />
  );
}
