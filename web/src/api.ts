import type { AuthConfig, Overview, Problem, Session } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let problem: Problem = {};
    try {
      problem = (await response.json()) as Problem;
    } catch {
      // Preserve a stable client error when the server returned no JSON body.
    }
    throw new ApiError(
      problem.detail ?? "The request could not be completed.",
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getSession() {
  return request<Session>("/session");
}

export function getAuthConfig() {
  return request<AuthConfig>("/auth/config");
}

export function login(input: { username: string; password: string }) {
  return request<Session>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function signup(input: {
  username: string;
  displayName: string;
  baseCurrency: string;
  password: string;
  confirmPassword: string;
}) {
  return request<Session>("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function logout(csrfToken: string) {
  return request<{ status: string }>("/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  });
}

export function getOverview() {
  return request<Overview>("/overview");
}
