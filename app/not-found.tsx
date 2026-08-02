import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center p-6 text-center">
      <div>
        <SearchX className="mx-auto text-slate-500" size={40} />
        <h1 className="mt-4 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          This Wealthboard view does not exist.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Return to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
