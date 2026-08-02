"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signupRateLimit, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";
import { registerUser, UsernameUnavailableError } from "@/lib/auth/users";
import {
  formDataObject,
  signupSchema,
  type ActionState,
  zodActionError,
} from "@/lib/validation";

export async function signupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);

  const requestHeaders = await headers();
  const address =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "local";
  const rateLimit = signupRateLimit(address);
  if (!rateLimit.allowed) {
    return {
      message: `Too many attempts. Try again in ${rateLimit.retryAfterMinutes} minutes.`,
    };
  }

  try {
    const registered = await registerUser(parsed.data);
    recordLoginAttempt(rateLimit, true);
    await createSession(
      registered.userId,
      registered.sessionVersion,
      registered.sessionTimeoutMinutes,
    );
  } catch (error) {
    if (error instanceof UsernameUnavailableError) {
      return { message: error.message };
    }
    console.error(
      "Signup failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      message:
        error instanceof Error && error.message.includes("SESSION_SECRET")
          ? error.message
          : "Your account could not be created. Try again.",
    };
  }

  redirect("/");
}
