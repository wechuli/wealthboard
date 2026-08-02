import { NextResponse } from "next/server";

import { getSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok", service: "wealthboard" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
