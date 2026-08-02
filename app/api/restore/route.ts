import { getSession } from "@/lib/auth/session";
import { restoreDatabase } from "@/lib/services/portability";
import { requireTrustedOrigin } from "@/lib/auth/origin";

export async function POST(request: Request) {
  if (!(await getSession())) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    requireTrustedOrigin(request);
  } catch {
    return Response.json({ error: "The request origin is not trusted." }, { status: 403 });
  }
  const formData = await request.formData();
  const file = formData.get("database");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a SQLite database file." }, { status: 400 });
  }
  if (file.size > 100 * 1024 * 1024) {
    return Response.json({ error: "Database restore is limited to 100 MB." }, { status: 413 });
  }
  try {
    const preRestore = await restoreDatabase(new Uint8Array(await file.arrayBuffer()));
    return Response.json({
      message: "Database restored successfully.",
      preRestoreBackup: preRestore,
    });
  } catch (error) {
    console.error("Database restore rejected:", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: error instanceof Error ? error.message : "The database could not be restored." },
      { status: 400 },
    );
  }
}
