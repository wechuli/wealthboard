"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { getAuthConfig } from "@/lib/auth/config";
import { requireTrustedHeadersOrigin } from "@/lib/auth/origin";
import {
  accountSchema,
  categorySchema,
  formDataObject,
  goalMilestoneSchema,
  goalSchema,
  institutionSchema,
  localCredentialSchema,
  passwordConfirmationSchema,
  passwordChangeSchema,
  transactionSchema,
  transactionUpdateSchema,
  transferSchema,
  valuationSchema,
  type ActionState,
  zodActionError,
} from "@/lib/validation";
import {
  createAccount,
  deleteTransaction,
  deleteValuation,
  recordTransaction,
  recordValuation,
  setAccountArchived,
  updateAccount,
  updateTransaction,
} from "@/lib/services/accounts";
import {
  archiveCategory,
  createCategory,
  moveCategory,
  updateCategory,
} from "@/lib/services/categories";
import {
  createInstitution,
  setInstitutionArchived,
  updateInstitution,
} from "@/lib/services/institutions";
import {
  createGoal,
  createGoalMilestone,
  deleteGoal,
  deleteGoalMilestone,
  dismissGoalAlert,
  setGoalStatus,
  updateGoal,
} from "@/lib/services/goals";
import { recordTransfer } from "@/lib/services/transfers";
import type { GoalStatus, InstitutionType } from "@/db/schema";
import { addExchangeRate, updateSettings } from "@/lib/services/settings";
import { createSession } from "@/lib/auth/session";
import {
  AuthenticationMethodError,
  changeUserPassword,
  enableLocalCredential,
  getUserAuthState,
  removeLocalCredential,
  unlinkOidcIdentity,
  UsernameUnavailableError,
  verifyUserPassword,
} from "@/lib/auth/users";
import {
  clearOidcReauthGrant,
  consumeOidcReauthGrant,
  storeOidcTransaction,
} from "@/lib/auth/oidc-cookie";
import {
  constantTimeEqual,
  createAuthorizationRequest,
  discoverOidcProvider,
  openOidcReauthGrant,
  sealOidcTransaction,
} from "@/lib/auth/oidc";
import {
  loginRateLimit,
  oidcRequestRateLimit,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";
import { clientAddress } from "@/lib/auth/request";
import { z } from "zod";
import { isValidTimezone } from "@/lib/dates";
import { aiProviderSettingsInputSchema } from "@/lib/ai/schemas";
import {
  clearAiUsageHistory,
  deleteStoredAiCredential,
  disconnectAiProvider,
  saveAiProviderSettings,
} from "@/lib/services/ai-provider";

function mutationError(error: unknown): ActionState {
  console.error(
    "Financial mutation failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    message:
      error instanceof Error ? error.message : "The change could not be saved.",
  };
}

async function trustedActionOrigin() {
  try {
    requireTrustedHeadersOrigin(await headers());
    return true;
  } catch {
    return false;
  }
}

function accountInput(formData: FormData) {
  const values = formDataObject(formData);
  return accountSchema.safeParse({
    ...values,
    isIncludedInNetWorth: formData.get("isIncludedInNetWorth") === "on",
  });
}

export async function updateAiProviderSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  void _previous;
  const { userId } = await requireSession();
  const values = formDataObject(formData);
  const parsed = aiProviderSettingsInputSchema.safeParse({
    provider: values.provider,
    baseUrl: values.baseUrl,
    model: values.model,
    apiKey: values.apiKey,
    rememberApiKey: formData.get("rememberApiKey") === "on",
    includeExactAmounts: formData.get("includeExactAmounts") === "on",
    includeAccountNames: formData.get("includeAccountNames") === "on",
    monthlyTokenLimit: values.monthlyTokenLimit,
    maxOutputTokens: values.maxOutputTokens,
  });
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    saveAiProviderSettings(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/settings");
  revalidatePath("/review");
  return { ok: true, message: "AI provider settings saved." };
}

export async function deleteStoredAiCredentialAction(
  _previous: ActionState,
): Promise<ActionState> {
  void _previous;
  const { userId } = await requireSession();
  try {
    deleteStoredAiCredential(userId);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/settings");
  revalidatePath("/review");
  return { ok: true, message: "Stored AI credential deleted." };
}

export async function clearAiUsageHistoryAction(
  _previous: ActionState,
): Promise<ActionState> {
  void _previous;
  const { userId } = await requireSession();
  clearAiUsageHistory(userId);
  revalidatePath("/settings");
  return { ok: true, message: "AI usage history cleared." };
}

export async function disconnectAiProviderAction(
  _previous: ActionState,
): Promise<ActionState> {
  void _previous;
  const { userId } = await requireSession();
  try {
    disconnectAiProvider(userId);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/settings");
  revalidatePath("/review");
  return { ok: true, message: "AI provider disconnected." };
}

export async function createAccountAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = accountInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  let id: string;
  try {
    id = createAccount(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  redirect(`/accounts/${id}?created=1`);
}

export async function updateAccountAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = accountInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateAccount(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/estate");
  redirect(`/accounts/${id}?updated=1`);
}

export async function archiveAccountAction(id: string, archived: boolean) {
  const { userId } = await requireSession();
  setAccountArchived(userId, id, archived);
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/estate");
  redirect("/accounts");
}

export async function transactionAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const values = formDataObject(formData);
  if (values.type === "transfer") {
    const parsed = transferSchema.safeParse({
      ...values,
      fromAccountId: values.accountId,
    });
    if (!parsed.success) return zodActionError(parsed.error);
    try {
      recordTransfer(userId, parsed.data);
    } catch (error) {
      return mutationError(error);
    }
    revalidatePath("/");
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    redirect("/transactions?created=1");
  }

  const parsed = transactionSchema.safeParse(values);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    recordTransaction(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath("/transactions");
  redirect(`/accounts/${parsed.data.accountId}?transaction=created`);
}

export async function updateTransactionAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = transactionUpdateSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateTransaction(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath("/transactions");
  redirect(`/accounts/${parsed.data.accountId}?transaction=updated`);
}

export async function deleteTransactionAction(id: string) {
  const { userId } = await requireSession();
  try {
    deleteTransaction(userId, id);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

export async function valuationAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = valuationSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    recordValuation(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  redirect(`/accounts/${parsed.data.accountId}?valuation=created`);
}

export async function deleteValuationAction(id: string) {
  const { userId } = await requireSession();
  try {
    deleteValuation(userId, id);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
}

function categoryInput(formData: FormData) {
  return categorySchema.safeParse({
    ...formDataObject(formData),
    isLiquid: formData.get("isLiquid") === "on",
    isInvestible: formData.get("isInvestible") === "on",
  });
}

export async function createCategoryAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = categoryInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    createCategory(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/categories");
  revalidatePath("/accounts");
  return { ok: true, message: "Category created." };
}

export async function updateCategoryAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = categoryInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateCategory(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/categories");
  revalidatePath("/accounts");
  return { ok: true, message: "Category updated." };
}

export async function archiveCategoryAction(id: string, archived: boolean) {
  const { userId } = await requireSession();
  try {
    archiveCategory(userId, id, archived);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/categories");
  revalidatePath("/accounts");
}

export async function moveCategoryAction(id: string, direction: "up" | "down") {
  const { userId } = await requireSession();
  moveCategory(userId, id, direction);
  revalidatePath("/categories");
}

function institutionInput(formData: FormData) {
  return institutionSchema.safeParse(formDataObject(formData));
}

function revalidateInstitutionViews() {
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/institutions");
  revalidatePath("/reports");
}

export async function createInstitutionAction(formData: FormData): Promise<
  ActionState & {
    institution?: {
      id: string;
      name: string;
      type: InstitutionType;
    };
  }
> {
  const { userId } = await requireSession();
  const parsed = institutionInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  let id: string;
  try {
    id = createInstitution(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidateInstitutionViews();
  return {
    ok: true,
    message: "Institution created.",
    institution: { id, name: parsed.data.name, type: parsed.data.type },
  };
}

export async function updateInstitutionAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = institutionInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateInstitution(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidateInstitutionViews();
  return { ok: true, message: "Institution updated." };
}

export async function archiveInstitutionAction(id: string, archived: boolean) {
  const { userId } = await requireSession();
  try {
    setInstitutionArchived(userId, id, archived);
  } catch (error) {
    return mutationError(error);
  }
  revalidateInstitutionViews();
}

export async function createGoalAction(
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = goalSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  let id: string;
  try {
    id = createGoal(userId, {
      ...parsed.data,
      linkedAccountId: parsed.data.linkedAccountId || undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/accounts");
  redirect(`/goals/${id}?created=1`);
}

export async function updateGoalAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = goalSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateGoal(userId, id, {
      ...parsed.data,
      linkedAccountId: parsed.data.linkedAccountId || undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/accounts");
  redirect(`/goals/${id}?updated=1`);
}

export async function setGoalStatusAction(id: string, status: GoalStatus) {
  const { userId } = await requireSession();
  setGoalStatus(userId, id, status);
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
}

export async function deleteGoalAction(id: string) {
  const { userId } = await requireSession();
  deleteGoal(userId, id);
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/accounts");
  redirect("/goals");
}

export async function createGoalMilestoneAction(
  goalId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = goalMilestoneSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    createGoalMilestone(userId, goalId, {
      ...parsed.data,
      targetDate: parsed.data.targetDate || undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/goals");
  return { ok: true, message: "Milestone added." };
}

export async function deleteGoalMilestoneAction(
  goalId: string,
  milestoneId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    deleteGoalMilestone(userId, goalId, milestoneId);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/goals");
  return { ok: true, message: "Milestone deleted." };
}

export async function dismissGoalAlertAction(
  goalId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    dismissGoalAlert(userId, goalId);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/goals");
  return { ok: true, message: "Goal reminder dismissed for this month." };
}

const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  appName: z.string().trim().min(1).max(80),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  supportedCurrencies: z.string().transform((value) => [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  ]),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(isValidTimezone, "Enter a valid IANA timezone."),
  preferredDateFormat: z.string().trim().min(1).max(40),
  defaultDashboardPeriod: z.enum(["1m", "3m", "6m", "1y", "all"]),
  sessionTimeoutMinutes: z.coerce.number().int().min(15).max(525600),
  defaultGoalReturn: z.coerce.number().min(0).max(100),
});

export async function updateSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = settingsSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  if (!parsed.data.supportedCurrencies.includes(parsed.data.baseCurrency)) {
    parsed.data.supportedCurrencies.unshift(parsed.data.baseCurrency);
  }
  try {
    updateSettings(userId, {
      ...parsed.data,
      defaultGoalReturnBps: Math.round(parsed.data.defaultGoalReturn * 100),
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

const exchangeRateSchema = z.object({
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  quoteCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  rate: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/),
  effectiveDate: z.string().date(),
});

export async function exchangeRateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = exchangeRateSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    addExchangeRate(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/reports");
  revalidatePath("/settings");
  return { ok: true, message: "Exchange rate saved." };
}

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  if (!getAuthConfig().localEnabled) {
    return { message: "Password authentication is not available." };
  }
  if (!(await trustedActionOrigin())) {
    return { message: "The request could not be verified." };
  }
  const parsed = passwordChangeSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  const session = await changeUserPassword(
    userId,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!session) {
    return { message: "The current password is incorrect." };
  }
  await createSession(
    userId,
    session.sessionVersion,
    session.sessionTimeoutMinutes,
  );
  return {
    ok: true,
    message: "Password changed. Other sessions were signed out.",
  };
}

function hybridOidcConfig() {
  const config = getAuthConfig();
  return config.localEnabled && config.oidcEnabled ? config.oidc : undefined;
}

async function settingsOidcRedirect(
  userId: string,
  sessionVersion: number,
  intent: "link" | "reauth_local",
  next: string,
) {
  const oidc = hybridOidcConfig();
  if (!oidc) return null;
  const metadata = await discoverOidcProvider(oidc);
  const authorization = createAuthorizationRequest(oidc, metadata, {
    intent,
    linkingUserId: userId,
    linkingSessionVersion: sessionVersion,
    next,
  });
  await storeOidcTransaction(
    await sealOidcTransaction(oidc, authorization.transaction),
  );
  return authorization.authorizationUrl.toString();
}

async function confirmPasswordForAuthChange(
  userId: string,
  username: string,
  password: string,
) {
  const requestHeaders = await headers();
  const rateLimit = loginRateLimit(
    `auth-change:${username}`,
    clientAddress(requestHeaders),
  );
  if (!rateLimit.allowed) {
    return {
      ok: false as const,
      message: `Too many attempts. Try again in ${rateLimit.retryAfterMinutes} minutes.`,
    };
  }
  const verified = await verifyUserPassword(userId, password);
  recordLoginAttempt(rateLimit, verified);
  return verified
    ? { ok: true as const }
    : { ok: false as const, message: "The current password is incorrect." };
}

async function allowOidcSettingsStart() {
  const requestHeaders = await headers();
  return oidcRequestRateLimit("start", clientAddress(requestHeaders));
}

export async function startOidcLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId, username, version } = await requireSession();
  const oidc = hybridOidcConfig();
  if (!oidc) return { message: "OIDC linking is not available." };
  if (!(await trustedActionOrigin())) {
    return { message: "The request could not be verified." };
  }
  const parsed = passwordConfirmationSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  const state = getUserAuthState(userId, oidc.issuer);
  if (!state?.hasPassword || state.oidcIdentity) {
    return { message: "OIDC linking is not available." };
  }
  const passwordConfirmation = await confirmPasswordForAuthChange(
    userId,
    username,
    parsed.data.currentPassword,
  );
  if (!passwordConfirmation.ok)
    return { message: passwordConfirmation.message };
  const rateLimit = await allowOidcSettingsStart();
  if (!rateLimit.allowed) {
    return { message: "Too many provider sign-in requests. Try again later." };
  }

  let authorizationUrl: string | null;
  try {
    authorizationUrl = await settingsOidcRedirect(
      userId,
      version,
      "link",
      "/settings?auth=linked",
    );
  } catch (error) {
    console.error(
      "OIDC link initiation failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { message: "Provider sign-in is temporarily unavailable." };
  }
  if (!authorizationUrl) return { message: "OIDC linking is not available." };
  redirect(authorizationUrl);
}

export async function startOidcReauthenticationAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _previous;
  void _formData;
  const { userId, version } = await requireSession();
  const oidc = hybridOidcConfig();
  if (!oidc) return { message: "OIDC reauthentication is not available." };
  if (!(await trustedActionOrigin())) {
    return { message: "The request could not be verified." };
  }
  const state = getUserAuthState(userId, oidc.issuer);
  if (!state?.oidcIdentity) {
    return { message: "OIDC reauthentication is not available." };
  }
  const rateLimit = await allowOidcSettingsStart();
  if (!rateLimit.allowed) {
    return { message: "Too many provider sign-in requests. Try again later." };
  }

  let authorizationUrl: string | null;
  try {
    authorizationUrl = await settingsOidcRedirect(
      userId,
      version,
      "reauth_local",
      "/settings?auth=reauthenticated",
    );
  } catch (error) {
    console.error(
      "OIDC reauthentication initiation failed safely:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { message: "Provider sign-in is temporarily unavailable." };
  }
  if (!authorizationUrl) {
    return { message: "OIDC reauthentication is not available." };
  }
  redirect(authorizationUrl);
}

export async function unlinkOidcIdentityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId, username } = await requireSession();
  const oidc = hybridOidcConfig();
  if (!oidc) return { message: "OIDC unlinking is not available." };
  if (!(await trustedActionOrigin())) {
    return { message: "The request could not be verified." };
  }
  const parsed = passwordConfirmationSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  const state = getUserAuthState(userId, oidc.issuer);
  if (!state?.hasPassword || !state.oidcIdentity) {
    return { message: "OIDC unlinking is not available." };
  }
  const passwordConfirmation = await confirmPasswordForAuthChange(
    userId,
    username,
    parsed.data.currentPassword,
  );
  if (!passwordConfirmation.ok)
    return { message: passwordConfirmation.message };
  try {
    const session = unlinkOidcIdentity(userId, oidc.issuer);
    await createSession(
      userId,
      session.sessionVersion,
      session.sessionTimeoutMinutes,
    );
  } catch (error) {
    if (!(error instanceof AuthenticationMethodError)) throw error;
    return { message: error.message };
  }
  revalidatePath("/settings");
  return { ok: true, message: "OIDC sign-in was unlinked." };
}

async function verifiedReauthUser(userId: string) {
  const oidc = hybridOidcConfig();
  if (!oidc) return null;
  const token = await consumeOidcReauthGrant();
  if (!token) return null;
  try {
    const grant = await openOidcReauthGrant(oidc, token);
    if (!constantTimeEqual(grant.userId, userId)) {
      await clearOidcReauthGrant();
      return null;
    }
    return oidc;
  } catch {
    await clearOidcReauthGrant();
    return null;
  }
}

export async function enableLocalCredentialAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  if (!(await trustedActionOrigin())) {
    return { message: "The request could not be verified." };
  }
  const parsed = localCredentialSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  const oidc = await verifiedReauthUser(userId);
  if (!oidc) return { message: "Verify with your provider before continuing." };
  try {
    const session = await enableLocalCredential(userId, {
      username: parsed.data.username,
      password: parsed.data.password,
      issuer: oidc.issuer,
    });
    await clearOidcReauthGrant();
    await createSession(
      userId,
      session.sessionVersion,
      session.sessionTimeoutMinutes,
    );
  } catch (error) {
    if (error instanceof UsernameUnavailableError) {
      return {
        message: error.message,
        fieldErrors: { username: [error.message] },
      };
    }
    if (!(error instanceof AuthenticationMethodError)) throw error;
    await clearOidcReauthGrant();
    return { message: error.message };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Local password sign-in was enabled." };
}

export async function removeLocalCredentialAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _previous;
  void _formData;
  const { userId } = await requireSession();
  if (!(await trustedActionOrigin())) {
    return { message: "The request could not be verified." };
  }
  const oidc = await verifiedReauthUser(userId);
  if (!oidc) return { message: "Verify with your provider before continuing." };
  try {
    const session = removeLocalCredential(userId, oidc.issuer);
    await clearOidcReauthGrant();
    await createSession(
      userId,
      session.sessionVersion,
      session.sessionTimeoutMinutes,
    );
  } catch (error) {
    await clearOidcReauthGrant();
    if (!(error instanceof AuthenticationMethodError)) throw error;
    return { message: error.message };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Local password sign-in was removed." };
}
