import { getSession } from "@/lib/auth/session";
import { accountCsv } from "@/lib/services/portability";

export async function GET() {
  const session = await getSession();
  if (!session)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  return new Response(await accountCsv(session.userId), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wealthboard-accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
