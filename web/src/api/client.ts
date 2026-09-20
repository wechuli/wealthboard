import type {
  Account,
  AccountAnalytics,
  AccountConversionInput,
  AccountConversionPreview,
  AccountConversionResult,
  AccountInput,
  AccountList,
  ActivityPage,
  AIRead,
  APIKeyList,
  AuthConfig,
  Category,
  CategoryList,
  CategoryInput,
  CreateAPIKeyInput,
  CreatedAPIKey,
  Dashboard,
  EstateSnapshot,
  EstateWorkspace,
  Goal,
  GoalAlert,
  GoalMilestone,
  Institution,
  InstitutionList,
  InstitutionInput,
  InstrumentInput,
  InstrumentDetail,
  InstrumentList,
  Overview,
  Problem,
  GoalInput,
  GoalMilestoneInput,
  MutationID,
  MutationStatus,
  PositionEventPage,
  PositionEventInput,
  PositionReconciliationPage,
  PositionReconciliationInput,
  ReportAllocation,
  ReportSummary,
  Session,
  SecurityPriceInput,
  SettingsInput,
  SettingsRead,
  TransactionInput,
  TransactionPage,
  TransferInput,
  ValuationInput,
  ValuationPage,
  ExchangeRateInput,
  CorporateActionInput,
  ImportResult,
  RestoreSummary,
  EstatePlanInput,
  BeneficiaryInput,
  EstateDirectiveInput,
  EstateAllocationInput,
  AISettingsInput,
  AISource,
  AIConversionDraft,
} from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
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
    let problem:
      | Problem
      | { detail?: string; error?: string; code?: string }
      | undefined;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      // Preserve a stable client error when the server returned no JSON body.
    }
    throw new ApiError(
      problem && "detail" in problem
        ? (problem.detail ?? "The request could not be completed.")
        : (problem?.error ?? "The request could not be completed."),
      response.status,
      problem && "code" in problem ? problem.code : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function fileRequest<T>(
  path: string,
  csrfToken: string,
  body: FormData,
  headers?: Record<string, string>,
): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken, ...headers },
    body,
  });
}

export async function downloadExport(path: string, filename: string) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new ApiError("The export could not be downloaded.", response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function mutate<T>(
  path: string,
  csrfToken: string,
  init: Omit<RequestInit, "body"> & { body?: unknown; idempotencyKey?: string },
) {
  const { body, idempotencyKey, ...requestInit } = init;
  return request<T>(path, {
    ...requestInit,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-Token": csrfToken,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...requestInit.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

export const getDashboard = (range = "1y") =>
  request<Dashboard>(`/dashboard?range=${encodeURIComponent(range)}`);
export const getAccounts = () => request<AccountList>("/accounts");
export const getAccount = (id: string) => request<Account>(`/accounts/${id}`);
export const getAccountActivity = (id: string) =>
  request<ActivityPage>(`/accounts/${id}/activity?limit=100`);
export const getAccountTransactions = (id: string) =>
  request<TransactionPage>(`/accounts/${id}/transactions?limit=100`);
export const getAccountValuations = (id: string) =>
  request<ValuationPage>(`/accounts/${id}/valuations?limit=100`);
export const getAccountAnalytics = (id: string) =>
  request<AccountAnalytics>(`/accounts/${id}/analytics`);
export const getAccountPositionEvents = (id: string) =>
  request<PositionEventPage>(`/accounts/${id}/position-events?limit=100`);
export const getAccountPositionReconciliations = (id: string) =>
  request<PositionReconciliationPage>(
    `/accounts/${id}/position-reconciliations?limit=100`,
  );
export const getTransactions = () =>
  request<TransactionPage>("/transactions?limit=100");
export const getCategories = () => request<CategoryList>("/categories");
export const getInstitutions = () => request<InstitutionList>("/institutions");
export const getGoals = () => request<Goal[]>("/goals");
export const getGoal = (id: string) => request<Goal>(`/goals/${id}`);
export const getGoalMilestones = (id: string) =>
  request<GoalMilestone[]>(`/goals/${id}/milestones`);
export const getGoalAlerts = () => request<GoalAlert[]>("/goals/alerts");
export const getReportSummary = () =>
  request<ReportSummary>("/reports/summary");
export const getReportAllocation = () =>
  request<ReportAllocation>("/reports/allocation");
export const getInstruments = () => request<InstrumentList>("/instruments");
export const getInstrument = (id: string) =>
  request<InstrumentDetail>(`/instruments/${id}`);
export const getEstate = () => request<EstateWorkspace>("/estate");
export const getEstateSnapshot = (id: string) =>
  request<EstateSnapshot>(`/estate/snapshots/${id}`);
export const getAI = () => request<AIRead>("/ai");
export const getSettings = () => request<SettingsRead>("/settings");
export const getAPIKeys = () => request<APIKeyList>("/api-keys");

export function createAPIKey(input: CreateAPIKeyInput, csrfToken: string) {
  return request<CreatedAPIKey>("/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(input),
  });
}

export function revokeAPIKey(id: string, csrfToken: string) {
  return request<void>(`/api-keys/${id}`, {
    method: "DELETE",
    headers: { "X-CSRF-Token": csrfToken },
  });
}

export function revokeAllAPIKeys(csrfToken: string) {
  return request<{ revoked: number }>("/api-keys/revoke-all", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  });
}

const jsonMutation = <T>(
  path: string,
  method: string,
  body: unknown,
  csrfToken: string,
  idempotencyKey?: string,
) => mutate<T>(path, csrfToken, { method, body, idempotencyKey });

const deleteMutation = (path: string, csrfToken: string, body?: unknown) =>
  mutate<void>(path, csrfToken, { method: "DELETE", body });

export const createCorporateAction = (
  kind: string,
  input: CorporateActionInput,
  csrf: string,
) =>
  mutate<{ eventGroupId: string }>(`/corporate-actions/${kind}`, csrf, {
    method: "POST",
    body: input,
    idempotencyKey: input.idempotencyKey,
  });
export const deleteCorporateActionGroup = (id: string, csrf: string) =>
  deleteMutation(`/corporate-actions/${id}`, csrf);

export function previewImport(
  accountId: string,
  kind: "history" | "investment",
  file: File,
  csrf: string,
) {
  const body = new FormData();
  body.append("file", file);
  const segment = kind === "history" ? "history-import" : "investment-import";
  return fileRequest<ImportResult>(
    `/accounts/${accountId}/${segment}/preview`,
    csrf,
    body,
  );
}

export function commitImport(
  accountId: string,
  kind: "history" | "investment",
  file: File,
  hash: string,
  csrf: string,
) {
  const body = new FormData();
  body.append("file", file);
  body.append("hash", hash);
  const segment = kind === "history" ? "history-import" : "investment-import";
  return fileRequest<ImportResult>(
    `/accounts/${accountId}/${segment}/commit`,
    csrf,
    body,
  );
}

export function restoreUser(file: File, csrf: string) {
  const body = new FormData();
  body.append("file", file);
  return fileRequest<RestoreSummary>("/restore/user", csrf, body);
}

export const updateEstatePlan = (input: EstatePlanInput, csrf: string) =>
  mutate<unknown>("/estate/plan", csrf, { method: "PUT", body: input });
export const createBeneficiary = (input: BeneficiaryInput, csrf: string) =>
  mutate<{ id: string }>("/estate/beneficiaries", csrf, {
    method: "POST",
    body: input,
  });
export const updateBeneficiary = (
  id: string,
  input: BeneficiaryInput,
  csrf: string,
) =>
  mutate<void>(`/estate/beneficiaries/${id}`, csrf, {
    method: "PUT",
    body: input,
  });
export const archiveBeneficiary = (
  id: string,
  archived: boolean,
  csrf: string,
) =>
  mutate<void>(`/estate/beneficiaries/${id}/archive`, csrf, {
    method: "PATCH",
    body: { archived },
  });
export const upsertEstateDirective = (
  accountId: string,
  input: EstateDirectiveInput,
  csrf: string,
) =>
  mutate<{ id: string }>(`/estate/directives/${accountId}`, csrf, {
    method: "PUT",
    body: input,
  });
export const upsertEstateAllocation = (
  directiveId: string,
  input: EstateAllocationInput,
  csrf: string,
) =>
  mutate<{ id: string }>(`/estate/allocations/${directiveId}`, csrf, {
    method: "PUT",
    body: input,
  });
export const deleteEstateAllocation = (id: string, csrf: string) =>
  deleteMutation(`/estate/allocations/${id}`, csrf);
export const upsertResiduaryAllocation = (
  input: EstateAllocationInput,
  csrf: string,
) =>
  mutate<{ id: string }>("/estate/residuary", csrf, {
    method: "PUT",
    body: input,
  });
export const deleteResiduaryAllocation = (id: string, csrf: string) =>
  deleteMutation(`/estate/residuary/${id}`, csrf);
export const createEstateSnapshot = (csrf: string) =>
  mutate<EstateSnapshot>("/estate/snapshots", csrf, { method: "POST" });
export const deleteEstateSnapshot = (id: string, csrf: string) =>
  deleteMutation(`/estate/snapshots/${id}`, csrf);

export const saveAISettings = (input: AISettingsInput, csrf: string) =>
  mutate<unknown>("/ai/settings", csrf, { method: "PUT", body: input });
export const saveAICredential = (apiKey: string, csrf: string) =>
  mutate<unknown>("/ai/credential", csrf, {
    method: "POST",
    body: { apiKey },
  });
export const deleteAICredential = (csrf: string) =>
  deleteMutation("/ai/credential", csrf);
export const disconnectAI = (csrf: string) =>
  deleteMutation("/ai/settings", csrf);
export const clearAIUsage = (csrf: string) =>
  mutate<{ deleted: number }>("/ai/usage/clear", csrf, { method: "POST" });
export const generateAIReview = (input: unknown, csrf: string) =>
  mutate<Record<string, unknown>>("/ai/review", csrf, {
    method: "POST",
    body: input,
  });
export function extractAIDocument(
  file: File,
  documentPassword: string,
  csrf: string,
) {
  const body = new FormData();
  body.append("file", file);
  if (documentPassword) body.append("documentPassword", documentPassword);
  return fileRequest<{ source: AISource }>("/ai/import/extract", csrf, body);
}
export const convertAIDocument = (input: unknown, csrf: string) =>
  mutate<AIConversionDraft>("/ai/import/convert", csrf, {
    method: "POST",
    body: input,
  });

export const updateSettings = (input: SettingsInput, csrf: string) =>
  jsonMutation<MutationStatus>("/settings", "PUT", input, csrf);
export const createCategory = (input: CategoryInput, csrf: string) =>
  jsonMutation<Category>("/categories", "POST", input, csrf);
export const updateCategory = (
  id: string,
  input: CategoryInput,
  csrf: string,
) => jsonMutation<MutationStatus>(`/categories/${id}`, "PUT", input, csrf);
export const archiveCategory = (id: string, archived: boolean, csrf: string) =>
  jsonMutation<MutationStatus>(
    `/categories/${id}/archive`,
    "PATCH",
    { archived },
    csrf,
  );
export const reorderCategory = (
  id: string,
  direction: "up" | "down",
  csrf: string,
) =>
  jsonMutation<MutationStatus>(
    `/categories/${id}/reorder`,
    "POST",
    { direction },
    csrf,
  );
export const createInstitution = (input: InstitutionInput, csrf: string) =>
  jsonMutation<Institution>("/institutions", "POST", input, csrf);
export const updateInstitution = (
  id: string,
  input: InstitutionInput,
  csrf: string,
) => jsonMutation<MutationStatus>(`/institutions/${id}`, "PUT", input, csrf);
export const archiveInstitution = (
  id: string,
  archived: boolean,
  csrf: string,
) =>
  jsonMutation<MutationStatus>(
    `/institutions/${id}/archive`,
    "PATCH",
    { archived },
    csrf,
  );
export const createExchangeRate = (input: ExchangeRateInput, csrf: string) =>
  jsonMutation<unknown>("/exchange-rates", "POST", input, csrf);
export const deleteExchangeRate = (id: string, csrf: string) =>
  deleteMutation(`/exchange-rates/${id}`, csrf);

export const createAccount = (input: AccountInput, csrf: string) =>
  jsonMutation<MutationID>(
    "/accounts",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
export const updateAccount = (id: string, input: AccountInput, csrf: string) =>
  jsonMutation<void>(`/accounts/${id}`, "PATCH", input, csrf);
export const archiveAccount = (id: string, archived: boolean, csrf: string) =>
  jsonMutation<void>(`/accounts/${id}/archive`, "POST", { archived }, csrf);
export const deleteAccount = (
  id: string,
  confirmationName: string,
  csrf: string,
) => deleteMutation(`/accounts/${id}`, csrf, { confirmationName });
export const createTransaction = (input: TransactionInput, csrf: string) =>
  jsonMutation<MutationID>(
    "/transactions",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
export const updateTransaction = (
  id: string,
  input: TransactionInput,
  csrf: string,
) => jsonMutation<void>(`/transactions/${id}`, "PATCH", input, csrf);
export const deleteTransaction = (id: string, csrf: string) =>
  deleteMutation(`/transactions/${id}`, csrf);
export const createValuation = (input: ValuationInput, csrf: string) =>
  jsonMutation<MutationID>(
    "/valuations",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
export const deleteValuation = (id: string, csrf: string) =>
  deleteMutation(`/valuations/${id}`, csrf);
export const createTransfer = (input: TransferInput, csrf: string) =>
  jsonMutation<MutationID>(
    "/transfers",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );

export const createGoal = (input: GoalInput, csrf: string) =>
  jsonMutation<MutationID & { replayed: boolean }>(
    "/goals",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
export const updateGoal = (id: string, input: GoalInput, csrf: string) =>
  jsonMutation<MutationStatus>(`/goals/${id}`, "PUT", input, csrf);
export const setGoalStatus = (id: string, status: string, csrf: string) =>
  jsonMutation<MutationStatus>(
    `/goals/${id}/status`,
    "PATCH",
    { status },
    csrf,
  );
export const deleteGoal = (id: string, csrf: string) =>
  deleteMutation(`/goals/${id}`, csrf);
export const createMilestone = (
  goalId: string,
  input: GoalMilestoneInput,
  csrf: string,
) =>
  jsonMutation<MutationID>(`/goals/${goalId}/milestones`, "POST", input, csrf);
export const deleteMilestone = (goalId: string, id: string, csrf: string) =>
  deleteMutation(`/goals/${goalId}/milestones/${id}`, csrf);
export const dismissGoalAlert = (goalId: string, csrf: string) =>
  jsonMutation<MutationStatus>(
    `/goals/${goalId}/alerts/dismiss`,
    "POST",
    {},
    csrf,
  );

export const createInstrument = (input: InstrumentInput, csrf: string) =>
  jsonMutation<MutationID>("/instruments", "POST", input, csrf);
export const updateInstrument = (
  id: string,
  input: InstrumentInput,
  csrf: string,
) => jsonMutation<void>(`/instruments/${id}`, "PUT", input, csrf);
export const archiveInstrument = (
  id: string,
  archived: boolean,
  csrf: string,
) =>
  jsonMutation<void>(`/instruments/${id}/archive`, "PATCH", { archived }, csrf);
export const deleteInstrument = (id: string, csrf: string) =>
  deleteMutation(`/instruments/${id}`, csrf);
export const upsertSecurityPrice = (input: SecurityPriceInput, csrf: string) =>
  jsonMutation<MutationID>("/security-prices", "PUT", input, csrf);
export const deleteSecurityPrice = (id: string, csrf: string) =>
  deleteMutation(`/security-prices/${id}`, csrf);
export const createPositionEvent = (input: PositionEventInput, csrf: string) =>
  jsonMutation<MutationID>(
    "/position-events",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
export const updatePositionEvent = (
  id: string,
  input: PositionEventInput,
  csrf: string,
) => jsonMutation<MutationID>(`/position-events/${id}`, "PUT", input, csrf);
export const deletePositionEvent = (id: string, csrf: string) =>
  deleteMutation(`/position-events/${id}`, csrf);
export const createPositionReconciliation = (
  input: PositionReconciliationInput,
  csrf: string,
) => jsonMutation<MutationID>("/position-reconciliations", "POST", input, csrf);
export const deletePositionReconciliation = (id: string, csrf: string) =>
  deleteMutation(`/position-reconciliations/${id}`, csrf);

export const previewAccountConversion = (
  input: AccountConversionInput,
  csrf: string,
) =>
  jsonMutation<AccountConversionPreview>(
    "/account-conversions/preview",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
export const executeAccountConversion = (
  input: AccountConversionInput,
  csrf: string,
) =>
  jsonMutation<AccountConversionResult>(
    "/account-conversions",
    "POST",
    input,
    csrf,
    input.idempotencyKey,
  );
