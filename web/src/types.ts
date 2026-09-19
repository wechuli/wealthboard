import type { components } from "./api-schema";

export type Session = components["schemas"]["SessionResponse"];

export type AuthConfig = components["schemas"]["AuthConfig"];

export type Overview = components["schemas"]["Overview"];

export type APIKeyMetadata = components["schemas"]["APIKeyMetadata"];
export type CreateAPIKeyInput = components["schemas"]["CreateAPIKeyRequest"];
export type CreatedAPIKey = APIKeyMetadata & { token: string };

export type Account = {
  id: string;
  categoryId: string;
  institutionId?: string;
  name: string;
  description?: string;
  currency: string;
  trackingMode: string;
  currentValueMinor: string;
  costBasisMinor?: string;
  isLiability: boolean;
  isIncludedInNetWorth: boolean;
  categoryName: string;
  institutionName?: string;
  accountReference?: string;
  notes?: string;
  openedAt?: string;
  archivedAt?: string;
};

export type Transaction = {
  id: string;
  accountId: string;
  accountName: string;
  type: string;
  amountMinor: string;
  currency: string;
  transactionDate: string;
  description?: string;
  notes?: string;
};

export type Valuation = {
  id: string;
  accountId: string;
  accountName: string;
  valueMinor: string;
  currency: string;
  valuationDate: string;
  notes?: string;
};

export type ActivityItem = {
  kind: string;
  id: string;
  accountId: string;
  accountName: string;
  type: string;
  amountMinor: string;
  currency: string;
  date: string;
  description?: string;
  notes?: string;
};

export type Page<T> = {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  displayOrder: number;
  assetOrLiability: string;
  description?: string;
  isLiquid: boolean;
  isInvestible: boolean;
  isArchived: boolean;
  isSystem: boolean;
};

export type Institution = {
  id: string;
  name: string;
  type: string;
  websiteUrl?: string;
  countryCode?: string;
  address?: string;
  notes?: string;
  archivedAt?: string;
};

export type Goal = {
  id: string;
  name: string;
  description: string | null;
  targetAmountMinor: string;
  currentAmountMinor: string;
  currentAmountCurrency: string;
  currency: string;
  targetDate: string;
  linkedAccount: { id: string; name: string; currency: string } | null;
  icon: string;
  status: string;
  priority: number;
  assumedAnnualReturnBps: number;
  progressPercent: string;
  valueIncomplete: boolean;
  missingCurrencies: string[];
  plan: {
    plannedContributionMinor: string;
    frequency: string;
    startDate: string;
    endDate: string | null;
  } | null;
};

export type GoalMilestone = {
  id: string;
  goalId: string;
  name: string;
  targetAmountMinor: string;
  targetDate: string | null;
  status: string;
  progressPercent: string;
  remainingMinor: string | null;
};
export type GoalAlert = {
  goalId: string;
  goalName: string;
  currency: string;
  targetAmountMinor: string;
  currentAmountMinor: string;
  progressPercent: string;
  targetDate: string;
  alertKey: string;
  assumedAnnualReturnBps: number;
};
export type Totals = {
  assets: string;
  liabilities: string;
  netWorth: string;
  liquid: string;
  investible: string;
};
export type Dashboard = {
  asOf: string;
  baseCurrency: string;
  totals: Totals;
  accountCount: number;
  goalCount: number;
  currentComplete: boolean;
  missingCurrencies: string[];
  historicalAvailable: boolean;
  historicalComplete: boolean;
  valueBasis: string;
};
export type ReportSummary = Omit<
  Dashboard,
  "historicalAvailable" | "historicalComplete"
>;
export type AllocationItem = {
  name: string;
  valueMinor: string;
  sharePercent: string;
};
export type ReportAllocation = {
  asOf: string;
  baseCurrency: string;
  currentComplete: boolean;
  missingCurrencies: string[];
  valueBasis: string;
  categories: AllocationItem[];
  institutions: AllocationItem[];
  currencies: AllocationItem[];
};

export type SecurityPrice = {
  id: string;
  externalId: string | null;
  price: string;
  currency: string;
  effectiveDate: string;
  source: string;
  provenance: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Instrument = {
  id: string;
  externalId: string | null;
  name: string;
  symbol: string | null;
  identifierType: string;
  identifier: string | null;
  exchangeMic: string | null;
  assetType: string;
  quoteCurrency: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestPrice: SecurityPrice | null;
};
export type InstrumentDetail = {
  instrument: Instrument;
  prices: SecurityPrice[];
};

export type SettingsRead = {
  settings: {
    displayName: string;
    appName: string;
    baseCurrency: string;
    supportedCurrencies: string[];
    timezone: string;
    preferredDateFormat: string;
    defaultDashboardPeriod: string;
    sessionTimeoutMinutes: number;
    defaultGoalReturnBps: number;
    positionStaleDaysStock: number;
    positionStaleDaysEtf: number;
    positionStaleDaysFund: number;
    createdAt: string;
    updatedAt: string;
  };
  currencyConfiguration: {
    baseCurrency: string;
    enabledCurrencies: string[];
    referencedCurrencies: string[];
  };
  exchangeRates: {
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    effectiveDate: string;
    source: string;
    createdAt: string;
  }[];
  authMethods: {
    status: string;
    hasPassword: boolean;
    oidcIdentities: {
      id: string;
      issuer: string;
      createdAt: string;
      updatedAt: string;
      lastLoginAt: string;
    }[];
  };
};

export type EstateWorkspace = {
  plan: {
    id: string;
    title: string;
    jurisdiction: string | null;
    lastReviewedDate: string | null;
    reviewReminderDate: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  beneficiaries: {
    id: string;
    kind: string;
    name: string;
    relationship: string | null;
    contactSummary: string | null;
    notes: string | null;
    archivedAt: string | null;
  }[];
  directives: {
    id: string;
    estatePlanId: string;
    accountId: string;
    accountName: string;
    currency: string;
    currentValueMinor: string;
    isLiability: boolean;
    accountArchivedAt: string | null;
    isIncluded: boolean;
    ownershipShareBps: number;
    transferContext: string;
    distributionMethod: string;
    documentReference: string | null;
    notes: string | null;
    reviewedAt: string | null;
  }[];
  allocations: {
    id: string;
    estatePlanId: string;
    directiveId: string;
    beneficiaryId: string;
    tier: string;
    allocationBps: number;
    notes: string | null;
  }[];
  residuaryAllocations: {
    id: string;
    estatePlanId: string;
    beneficiaryId: string;
    tier: string;
    allocationBps: number;
    notes: string | null;
  }[];
  snapshots: EstateSnapshotMeta[];
  currentValuesComplete: boolean;
  currentValuesWarning: string;
};
export type EstateSnapshotMeta = {
  id: string;
  estatePlanId: string;
  version: number;
  title: string;
  valueAsOfDate: string;
  baseCurrency: string;
  contentHash: string;
  generatedAt: string;
};
export type EstateSnapshot = EstateSnapshotMeta & { content: unknown };

export type AIRead = {
  settings: {
    provider: string;
    baseUrl: string;
    model: string;
    hasStoredApiKey: boolean;
    apiKeyHint: string | null;
    includeExactAmounts: boolean;
    includeAccountNames: boolean;
    monthlyTokenLimit: number;
    maxOutputTokens: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  usage: {
    billingMonth: string;
    chargedTokens: number;
    remainingTokens: number;
    monthlyTokenLimit: number;
    successfulReviews: number;
    lastUsedAt: string | null;
  };
  events: {
    id: string;
    provider: string;
    endpointHost: string;
    model: string;
    requestType: string;
    status: string;
    billingMonth: string;
    chargedTokens: number;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    errorCode: string | null;
    createdAt: string;
  }[];
  reviewAvailability: {
    available: boolean;
    reason: string;
    providerConfigured: boolean;
    storedCredentialAvailable: boolean;
    sessionCredentialAccepted: boolean;
    cooldownUntil: string | null;
    budgetRemainingTokens: number;
  };
};

export type Problem = {
  title?: string;
  detail?: string;
  status?: number;
};
