import { createHash } from "node:crypto";

import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  INVESTMENT_HISTORY_MAX_BYTES,
  InvestmentHistoryAccessError,
  InvestmentHistoryFileError,
  commitInvestmentHistory,
} from "@/lib/services/investment-history-import";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
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
    requireTrustedOrigin(request);
  } catch {
    return Response.json(
      { error: "The request origin is not trusted." },
      { status: 403, headers: noStore },
    );
  }
  const formData = await request.formData();
  const file = formData.get("file");
  const expectedHash = formData.get("hash");
  if (!(file instanceof File) || typeof expectedHash !== "string") {
    return Response.json(
      { error: "Preview the investment-history file before importing it." },
      { status: 400, headers: noStore },
    );
  }
  if (file.size > INVESTMENT_HISTORY_MAX_BYTES) {
    return Response.json(
      { error: "Investment history import is limited to 5 MB." },
      { status: 413, headers: noStore },
    );
  }
  const format = file.name.toLowerCase().endsWith(".csv")
    ? "csv"
    : file.name.toLowerCase().endsWith(".json")
      ? "json"
      : null;
  if (!format) {
    return Response.json(
      { error: "Choose a .csv or .json file." },
      { status: 400, headers: noStore },
    );
  }
  const content = await file.text();
  const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
    return Response.json(
      { error: "The file changed after preview. Preview it again." },
      { status: 409, headers: noStore },
    );
  }
  try {
    return Response.json(
      commitInvestmentHistory(
        session.userId,
        (await params).id,
        content,
        format,
      ),
      { headers: noStore },
    );
  } catch (error) {
    if (
      error instanceof InvestmentHistoryAccessError ||
      error instanceof InvestmentHistoryFileError
    ) {
      return Response.json(
        { error: error.message },
        {
          status: error instanceof InvestmentHistoryAccessError ? 404 : 400,
          headers: noStore,
        },
      );
    }
    return Response.json(
      { error: "No investment history was imported. Try again." },
      { status: 500, headers: noStore },
    );
  }
}
