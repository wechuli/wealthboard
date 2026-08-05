import { createHash } from "node:crypto";

import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  ACCOUNT_HISTORY_MAX_BYTES,
  AccountHistoryAccessError,
  AccountHistoryFileError,
  previewAccountHistory,
} from "@/lib/services/account-history-import";

const noStore = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: noStore },
    );
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
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Choose an Account History Import v1 CSV or JSON file." },
      { status: 400, headers: noStore },
    );
  }
  if (file.size > ACCOUNT_HISTORY_MAX_BYTES) {
    return Response.json(
      { error: "Account history import is limited to 5 MB." },
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

  try {
    const content = await file.text();
    const preview = previewAccountHistory(
      session.userId,
      (await params).id,
      content,
      format,
    );
    return Response.json(
      {
        ...preview,
        hash: createHash("sha256").update(content, "utf8").digest("hex"),
      },
      { headers: noStore },
    );
  } catch (error) {
    if (
      !(error instanceof AccountHistoryAccessError) &&
      !(error instanceof AccountHistoryFileError)
    ) {
      return Response.json(
        { error: "The account history preview could not be created." },
        { status: 500, headers: noStore },
      );
    }
    return Response.json(
      { error: error.message },
      {
        status: error instanceof AccountHistoryAccessError ? 404 : 400,
        headers: noStore,
      },
    );
  }
}
