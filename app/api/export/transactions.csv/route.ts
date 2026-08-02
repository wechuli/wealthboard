import { getSession } from "@/lib/auth/session";
import { transactionCsv } from "@/lib/services/portability";

export async function GET() {
  if (!(await getSession())) return Response.json({ error: "Authentication required." }, { status: 401 });
  return new Response(await transactionCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="worthboard-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
