"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthConfig } from "@/lib/auth/config";
import { clientAddress } from "@/lib/auth/request";
import { createSession, destroySession } from "@/lib/auth/session";
import { loginRateLimit, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { authenticateUser } from "@/lib/auth/users";
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
  if (!getAuthConfig().localEnabled) {
    return { message: "This sign-in method is not available." };
  }
  const parsed = loginSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);

  try {
    const requestHeaders = await headers();
    const address = clientAddress(requestHeaders);
    const rateLimit = loginRateLimit(parsed.data.username, address);
    if (!rateLimit.allowed) {
      return {
        message: `Too many attempts. Try again in ${rateLimit.retryAfterMinutes} minutes.`,
      };
    }

    const authenticated = await authenticateUser(
      parsed.data.username,
      parsed.data.password,
    );
    recordLoginAttempt(rateLimit, Boolean(authenticated));
    if (!authenticated) return { message: "Invalid username or password." };
    await createSession(
      authenticated.userId,
      authenticated.sessionVersion,
      authenticated.sessionTimeoutMinutes,
    );
  } catch (error) {
    console.error(
      "Login failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      message:
        error instanceof Error && error.message.includes("SESSION_SECRET")
          ? error.message
          : "Sign in is temporarily unavailable.",
    };
  }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
