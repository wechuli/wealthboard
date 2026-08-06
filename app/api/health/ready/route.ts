import { getAuthConfig } from "@/lib/auth/config";
import { checkAuthReadiness } from "@/lib/auth/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const readiness = await checkAuthReadiness(getAuthConfig());
    return Response.json(
      {
        status: readiness.ready ? "ready" : "unavailable",
        service: "wealthboard",
      },
      {
        status: readiness.ready ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "wealthboard" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
