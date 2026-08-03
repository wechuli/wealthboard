import { getSession } from "@/lib/auth/session";
import { transactionCsv } from "@/lib/services/portability";
import { parseTransactionListQuery } from "@/lib/validation";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const query = parseTransactionListQuery(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return new Response(await transactionCsv(session.userId, query), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wealthboard-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
