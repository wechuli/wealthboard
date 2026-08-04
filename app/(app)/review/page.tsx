import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";

import { PortfolioReviewWorkspace } from "@/components/portfolio-review-workspace";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import {
  getAiProviderSettings,
  getAiUsageSummary,
} from "@/lib/services/ai-provider";

export const metadata = { title: "Portfolio review" };

export default async function PortfolioReviewPage() {
  const { userId } = await requireSession();
  const [settings, usage] = await Promise.all([
    getAiProviderSettings(userId),
    getAiUsageSummary(userId),
  ]);

  return (
    <>
      <PageHeader
        title="Portfolio review"
        description="A provider-generated critique grounded in Wealthboard's deterministic portfolio snapshot."
        actions={
          <Button asChild variant="secondary">
            <Link href="/settings">
              <Settings size={16} /> Provider settings
            </Link>
          </Button>
        }
      />
      {settings ? (
        <PortfolioReviewWorkspace settings={settings} usage={usage} />
      ) : (
        <div className="border-y border-white/[0.06] py-16 text-center">
          <Sparkles className="mx-auto text-slate-600" size={30} />
          <h2 className="mt-4 text-lg font-semibold">
            Configure an AI provider
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
            Choose OpenAI, DeepSeek, or an operator-approved compatible endpoint
            before requesting a portfolio review.
          </p>
          <Button asChild className="mt-5">
            <Link href="/settings">
              <Settings size={16} /> Open settings
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}
