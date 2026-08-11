import { getSession } from "@/lib/auth/session";
import {
  EstatePlanningError,
  getEstatePlanSnapshot,
} from "@/lib/services/estate-planning";

const noStore = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: noStore },
    );
  }
  try {
    const snapshot = getEstatePlanSnapshot(session.userId, (await params).id);
    if (!snapshot) {
      return Response.json(
        { error: "Estate summary not found." },
        { status: 404, headers: noStore },
      );
    }
    return new Response(
      JSON.stringify(
        {
          id: snapshot.id,
          contentHash: snapshot.contentHash,
          content: snapshot.content,
        },
        null,
        2,
      ),
      {
        headers: {
          ...noStore,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="wealthboard-estate-summary-${snapshot.valueAsOfDate}.json"`,
        },
      },
    );
  } catch (error) {
    if (!(error instanceof EstatePlanningError)) {
      console.error(
        "Estate summary download failed:",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    return Response.json(
      { error: "The estate summary could not be downloaded." },
      { status: 500, headers: noStore },
    );
  }
}