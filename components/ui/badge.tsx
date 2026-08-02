import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "positive" | "warning" | "negative" | "info";
}) {
  const tones = {
    neutral: "bg-white/[0.06] text-slate-300",
    positive: "bg-emerald-400/10 text-emerald-300",
    warning: "bg-amber-400/10 text-amber-300",
    negative: "bg-red-400/10 text-red-300",
    info: "bg-cyan-400/10 text-cyan-300",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}
