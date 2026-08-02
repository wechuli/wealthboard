"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { userSettings } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth/session";
import { loginRateLimit, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getDatabase } from "@/lib/db";
import {
  formDataObject,
  loginSchema,
  type ActionState,
  zodActionError,
} from "@/lib/validation";

export async function loginAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);

  try {
    await ensureBootstrap();
    const requestHeaders = await headers();
    const identity =
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      requestHeaders.get("x-real-ip") ||
      "local";
    const rateLimit = loginRateLimit(identity);
    if (!rateLimit.allowed) {
      return {
        message: `Too many attempts. Try again in ${rateLimit.retryAfterMinutes} minutes.`,
      };
    }

    const settings = await getDatabase().select().from(userSettings).limit(1);
    const valid = settings[0]
      ? await bcrypt.compare(parsed.data.password, settings[0].passwordHash)
      : false;
    recordLoginAttempt(rateLimit, valid);
    if (!valid) return { message: "The password is incorrect." };
    await createSession();
  } catch (error) {
    console.error("Login failed safely:", error instanceof Error ? error.name : "UnknownError");
    return {
      message:
        error instanceof Error && error.message.includes("SESSION_SECRET")
          ? error.message
          : "Worthboard is not configured yet. Check the server environment.",
    };
  }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
