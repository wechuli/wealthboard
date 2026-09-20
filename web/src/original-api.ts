import type { Session } from "./types";

type Problem = { detail?: string };

async function authRequest<T>(
  path: string,
  csrfToken: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "follow",
    ...init,
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let problem: Problem | undefined;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      // Keep a stable message for redirects and empty error responses.
    }
    throw new Error(problem?.detail ?? "The request could not be completed.");
  }
  if (response.redirected) {
    window.location.assign(response.url);
    return undefined as T;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const authenticationOperations = {
  linkOidc(currentPassword: string, csrfToken: string) {
    return authRequest<void>("/auth/oidc/link", csrfToken, {
      method: "POST",
      body: JSON.stringify({ currentPassword, next: "/settings" }),
    });
  },
  unlinkOidc(currentPassword: string, csrfToken: string) {
    return authRequest<Session>("/auth/oidc/link", csrfToken, {
      method: "DELETE",
      body: JSON.stringify({ currentPassword }),
    });
  },
  reauthenticateOidc(csrfToken: string) {
    return authRequest<void>("/auth/oidc/reauth?next=/settings", csrfToken, {
      method: "POST",
    });
  },
  enableLocalCredential(
    input: { username: string; password: string; confirmPassword: string },
    csrfToken: string,
  ) {
    return authRequest<Session>("/auth/local-credential", csrfToken, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  removeLocalCredential(csrfToken: string) {
    return authRequest<Session>("/auth/local-credential", csrfToken, {
      method: "DELETE",
    });
  },
  changePassword(
    input: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    },
    csrfToken: string,
  ) {
    return authRequest<Session>("/auth/change-password", csrfToken, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

export type AuthenticationOperations = typeof authenticationOperations;
