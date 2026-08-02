import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import { restoreUserData } from "@/lib/services/portability";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  try {
    requireTrustedOrigin(request);
  } catch {
    return Response.json({ error: "The request origin is not trusted." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a Wealthboard JSON export." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return Response.json({ error: "User restore is limited to 25 MB." }, { status: 413 });
  }

  try {
    const archive: unknown = JSON.parse(await file.text());
    const result = restoreUserData(session.userId, archive);
    return Response.json({
      message: "Your portfolio was restored.",
      ...result,
    });
  } catch (error) {
    console.error(
      "User restore rejected:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "The user export is invalid and no data was changed." },
      { status: 400 },
    );
  }
}
