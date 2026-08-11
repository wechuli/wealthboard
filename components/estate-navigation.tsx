"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, ScrollText, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const sections = [
  { href: "/estate/beneficiaries", label: "Beneficiaries", icon: Users },
  { href: "/estate/distribution", label: "Distribution", icon: ListChecks },
  { href: "/estate/summary", label: "Summary", icon: ScrollText },
];

export function EstateNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Estate planning sections"
      className="mb-6 grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1"
    >
      {sections.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:text-sm",
            pathname.startsWith(href) && "bg-emerald-400/10 text-emerald-300",
          )}
        >
          <Icon size={16} aria-hidden />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
