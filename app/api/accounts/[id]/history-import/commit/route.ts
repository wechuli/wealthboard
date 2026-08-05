import { createHash } from "node:crypto";

import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  ACCOUNT_HISTORY_MAX_BYTES,
  AccountHistoryAccessError,
  AccountHistoryFileError,
  commitAccountHistory,
} from "@/lib/services/account-history-import";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  try {
    requireTrustedOrigin(request);
  } catch {
    return Response.json(
      { error: "The request origin is not trusted." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const expectedHash = formData.get("hash");
  if (!(file instanceof File) || typeof expectedHash !== "string") {
    return Response.json(
      { error: "Preview the account history file before importing it." },
      { status: 400 },
    );
  }
  if (file.size > ACCOUNT_HISTORY_MAX_BYTES) {
    return Response.json(
      { error: "Account history import is limited to 5 MB." },
      { status: 413 },
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
      { status: 400 },
    );
  }
  const content = await file.text();
  const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
    return Response.json(
      { error: "The file changed after preview. Preview it again." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return Response.json(
      commitAccountHistory(session.userId, (await params).id, content, format),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof AccountHistoryAccessError ||
      error instanceof AccountHistoryFileError
    ) {
      return Response.json(
        { error: error.message },
        {
          status: error instanceof AccountHistoryAccessError ? 404 : 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    return Response.json(
      { error: "No transactions were imported. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
