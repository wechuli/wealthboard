export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertAuthStartupReady } = await import("@/lib/auth/readiness");
  await assertAuthStartupReady();
}
