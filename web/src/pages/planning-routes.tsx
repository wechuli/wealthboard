import { PortedPlanningRoutes } from "@/pages/planning";
import type { Session } from "@/lib/types";

export default function PlanningRoutes({ session }: { session: Session }) {
  return <PortedPlanningRoutes session={session} />;
}
