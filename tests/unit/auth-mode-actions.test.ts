// @vitest-environment node

import { headers } from "next/headers";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getAuthConfig: vi.fn() }));
vi.mock("@/lib/auth/rate-limit", () => ({
  loginRateLimit: vi.fn(),
  signupRateLimit: vi.fn(),
  recordLoginAttempt: vi.fn(),
}));
vi.mock("@/lib/auth/request", () => ({ clientAddress: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/lib/auth/users", () => ({
  UsernameUnavailableError: class UsernameUnavailableError extends Error {},
  authenticateUser: vi.fn(),
  changeUserPassword: vi.fn(),
  registerUser: vi.fn(),
}));

import { changePasswordAction } from "@/app/(app)/actions";
import { loginAction } from "@/app/login/actions";
import { signupAction } from "@/app/signup/actions";
import { getAuthConfig } from "@/lib/auth/config";
import { changeUserPassword } from "@/lib/auth/users";
import { requireSession } from "@/lib/auth/session";

describe("authentication method action policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://wealth.example.test";
    vi.mocked(headers).mockResolvedValue(
      new Headers({ Origin: "https://wealth.example.test" }) as Awaited<
        ReturnType<typeof headers>
      >,
    );
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["oidc"],
      localEnabled: false,
      oidcEnabled: true,
    });
    vi.mocked(requireSession).mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      username: "oidc-user",
      version: 1,
    });
  });

  test("rejects crafted local login before parsing credentials", async () => {
    const result = await loginAction({}, new FormData());

    expect(result).toEqual({
      message: "This sign-in method is not available.",
    });
  });

  test("rejects crafted signup before parsing credentials", async () => {
    const result = await signupAction({}, new FormData());

    expect(result).toEqual({
      message: "Account creation is not available.",
    });
  });

  test("rejects password changes before parsing submitted passwords", async () => {
    const result = await changePasswordAction({}, new FormData());

    expect(result).toEqual({
      message: "Password authentication is not available.",
    });
    expect(changeUserPassword).not.toHaveBeenCalled();
  });

  test("local mode reaches normal validation", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["local"],
      localEnabled: true,
      oidcEnabled: false,
    });

    await expect(loginAction({}, new FormData())).resolves.toMatchObject({
      message: "Check the highlighted fields.",
    });
    await expect(signupAction({}, new FormData())).resolves.toMatchObject({
      message: "Check the highlighted fields.",
    });
    await expect(
      changePasswordAction({}, new FormData()),
    ).resolves.toMatchObject({ message: "Check the highlighted fields." });
  });

  test("security-sensitive actions reject an untrusted origin safely", async () => {
    vi.mocked(getAuthConfig).mockReturnValue({
      methods: ["local"],
      localEnabled: true,
      oidcEnabled: false,
    });
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({ Origin: "https://attacker.example" }) as Awaited<
        ReturnType<typeof headers>
      >,
    );

    await expect(changePasswordAction({}, new FormData())).resolves.toEqual({
      message: "The request could not be verified.",
    });
    expect(changeUserPassword).not.toHaveBeenCalled();
  });
});
