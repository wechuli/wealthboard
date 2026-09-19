import type {
  Account,
  ActivityItem,
  AIRead,
  APIKeyMetadata,
  AuthConfig,
  Category,
  CreateAPIKeyInput,
  CreatedAPIKey,
  Dashboard,
  EstateSnapshot,
  EstateWorkspace,
  Goal,
  GoalAlert,
  GoalMilestone,
  Institution,
  Instrument,
  InstrumentDetail,
  Overview,
  Page,
  Problem,
  ReportAllocation,
  ReportSummary,
  Session,
  SettingsRead,
  Transaction,
  Valuation,
} from "./types";

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

export const getDashboard = () => request<Dashboard>("/dashboard");
export const getAccounts = () => request<{ items: Account[] }>("/accounts");
export const getAccount = (id: string) => request<Account>(`/accounts/${id}`);
export const getAccountActivity = (id: string) => request<Page<ActivityItem>>(`/accounts/${id}/activity?limit=100`);
export const getAccountTransactions = (id: string) => request<Page<Transaction>>(`/accounts/${id}/transactions?limit=100`);
export const getAccountValuations = (id: string) => request<Page<Valuation>>(`/accounts/${id}/valuations?limit=100`);
export const getTransactions = () => request<Page<Transaction>>("/transactions?limit=100");
export const getCategories = () => request<{ items: Category[] }>("/categories");
export const getInstitutions = () => request<{ items: Institution[] }>("/institutions");
export const getGoals = () => request<Goal[]>("/goals");
export const getGoal = (id: string) => request<Goal>(`/goals/${id}`);
export const getGoalMilestones = (id: string) => request<GoalMilestone[]>(`/goals/${id}/milestones`);
export const getGoalAlerts = () => request<GoalAlert[]>("/goals/alerts");
export const getReportSummary = () => request<ReportSummary>("/reports/summary");
export const getReportAllocation = () => request<ReportAllocation>("/reports/allocation");
export const getInstruments = () => request<{ instruments: Instrument[] }>("/instruments");
export const getInstrument = (id: string) => request<InstrumentDetail>(`/instruments/${id}`);
export const getEstate = () => request<EstateWorkspace>("/estate");
export const getEstateSnapshot = (id: string) => request<EstateSnapshot>(`/estate/snapshots/${id}`);
export const getAI = () => request<AIRead>("/ai");
export const getSettings = () => request<SettingsRead>("/settings");
export const getAPIKeys = () => request<{ keys: APIKeyMetadata[] }>("/api-keys");

export function createAPIKey(input: CreateAPIKeyInput, csrfToken: string) {
  return request<CreatedAPIKey>("/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(input),
  });
}

export function revokeAPIKey(id: string, csrfToken: string) {
  return request<void>(`/api-keys/${id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } });
}
