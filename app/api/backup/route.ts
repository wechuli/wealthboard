import fs from "node:fs";
import path from "node:path";

import { getSession } from "@/lib/auth/session";
import { createDatabaseBackup } from "@/lib/services/portability";

export async function GET() {
  if (!(await getSession())) return Response.json({ error: "Authentication required." }, { status: 401 });
  const backup = await createDatabaseBackup();
  return new Response(fs.readFileSync(backup), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${path.basename(backup)}"`,
      "Cache-Control": "no-store",
    },
  });
}
