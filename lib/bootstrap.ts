import "server-only";

import { eq } from "drizzle-orm";

import { userSettings } from "@/db/schema";
import { getDatabase } from "@/lib/db";

export async function getSettings(userId: string) {
  const setting = await getDatabase().query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (!setting) throw new Error("Wealthboard settings are unavailable.");
  return setting;
}
