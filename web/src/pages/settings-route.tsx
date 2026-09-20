import { OriginalSettingsPage } from "@/pages/settings";
import type { Session } from "@/lib/types";

export default function SettingsRoute({ session }: { session: Session }) {
  return <OriginalSettingsPage session={session} />;
}
