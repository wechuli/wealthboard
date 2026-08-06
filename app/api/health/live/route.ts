export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "wealthboard" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
