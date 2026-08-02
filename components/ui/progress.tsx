import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  label,
}: {
  value: number;
  className?: string;
  label?: string;
}) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("h-2 overflow-hidden rounded-full bg-white/[0.07]", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safe}
    >
      <div
        className="h-full rounded-full bg-emerald-400 transition-[width] motion-reduce:transition-none"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}
