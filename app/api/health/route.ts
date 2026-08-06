import { GET as readiness } from "@/app/api/health/ready/route";

export const dynamic = "force-dynamic";

export function GET() {
  return readiness();
}
