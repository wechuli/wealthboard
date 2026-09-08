import { handleImportPreparation } from "@/lib/ai/import-http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleImportPreparation(request, params, "convert");
}
