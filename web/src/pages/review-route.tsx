import { OriginalPortfolioReviewPage } from "@/pages/review";
import type { Session } from "@/lib/types";

export default function ReviewRoute({ session }: { session: Session }) {
  return <OriginalPortfolioReviewPage session={session} />;
}
