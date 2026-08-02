import { getSession } from "@/lib/auth/session";
import { importTransactionsCsv } from "@/lib/services/portability";
import { requireTrustedOrigin } from "@/lib/auth/origin";

export async function POST(request: Request) {
  if (!(await getSession())) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    requireTrustedOrigin(request);
  } catch {
    return Response.json({ error: "The request origin is not trusted." }, { status: 403 });
  }
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a CSV file." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "CSV import is limited to 5 MB." }, { status: 413 });
  }
  try {
    const count = importTransactionsCsv(await file.text());
    return Response.json({ message: `${count} transactions imported.`, count });
  } catch (error) {
    console.error("CSV import rejected:", error instanceof Error ? error.name : "UnknownError");
    return Response.json(
      { error: error instanceof Error ? error.message : "The CSV could not be imported." },
      { status: 400 },
    );
  }
}
