import type { components, operations } from "./api-schema";

type OperationJsonResponse<
  Operation extends keyof operations,
  Status extends keyof operations[Operation]["responses"],
> = operations[Operation]["responses"][Status] extends {
  content: { "application/json": infer Response };
}
  ? Response
  : never;

export type Session = components["schemas"]["SessionResponse"];

export type AuthConfig = components["schemas"]["AuthConfig"];

export type Overview = components["schemas"]["Overview"];

export type APIKeyMetadata = components["schemas"]["APIKeyMetadata"];
export type CreateAPIKeyInput = components["schemas"]["CreateAPIKeyRequest"];
export type CreatedAPIKey = OperationJsonResponse<"createApiKey", 201>;

export type Account = components["schemas"]["Account"];
export type Transaction = components["schemas"]["Transaction"];
export type Valuation = components["schemas"]["Valuation"];
export type ActivityItem = components["schemas"]["ActivityItem"];
export type TransactionPage = components["schemas"]["TransactionPage"];
export type ValuationPage = components["schemas"]["ValuationPage"];
export type ActivityPage = components["schemas"]["ActivityPage"];
export type AccountList = OperationJsonResponse<"listAccounts", 200>;

export type Category = components["schemas"]["Category"];
export type CategoryList = OperationJsonResponse<"listCategories", 200>;
export type Institution = components["schemas"]["Institution"];
export type InstitutionList = OperationJsonResponse<"listInstitutions", 200>;

export type Goal = components["schemas"]["Goal"];
export type GoalMilestone = components["schemas"]["GoalMilestone"];
export type GoalAlert = components["schemas"]["GoalAlert"];

export type Dashboard = components["schemas"]["Dashboard"];
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportAllocation = components["schemas"]["ReportAllocation"];

export type SecurityPrice = components["schemas"]["SecurityPrice"];
export type Instrument = components["schemas"]["Instrument"];
export type InstrumentDetail = components["schemas"]["InstrumentDetail"];
export type InstrumentList = OperationJsonResponse<"listInstruments", 200>;

export type SettingsRead = components["schemas"]["SettingsRead"];

export type EstateWorkspace = components["schemas"]["EstateWorkspace"];
export type EstateSnapshot = components["schemas"]["EstateSnapshot"];

export type AIRead = components["schemas"]["AIRead"];

export type APIKeyList = OperationJsonResponse<"listApiKeys", 200>;
export type Problem =
  components["responses"]["Problem"]["content"]["application/problem+json"];

export type MutationID = { id: string };
export type MutationStatus = { status: string };

export type SettingsInput = {
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
};

export type CategoryInput = {
  name: string;
  icon: string;
  assetOrLiability: "asset" | "liability";
  description: string;
  isLiquid: boolean;
  isInvestible: boolean;
};

export type InstitutionInput = {
  name: string;
  type:
    | "bank"
    | "credit_union"
    | "brokerage"
    | "asset_manager"
    | "pension_provider"
    | "insurer"
    | "lender"
    | "digital_wallet"
    | "government"
    | "employer"
    | "other";
  websiteUrl: string;
  countryCode: string;
  address: string;
  notes: string;
};

export type ExchangeRateInput = {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  effectiveDate: string;
};

export type AccountInput = {
  idempotencyKey?: string;
  name: string;
  description: string;
  categoryId: string;
  institutionId: string | null;
  accountReference: string;
  currency: string;
  trackingMode: string;
  openingValueMinor: string;
  costBasisMinor: string | null;
  isIncludedInNetWorth: boolean;
  notes: string;
  openedAt: string | null;
};

export type TransactionInput = {
  idempotencyKey?: string;
  accountId: string;
  type: string;
  amountMinor: string;
  transactionDate: string;
  description: string;
  externalId: string;
  notes: string;
};

export type ValuationInput = {
  idempotencyKey: string;
  accountId: string;
  valueMinor: string;
  valuationDate: string;
  notes: string;
};

export type TransferInput = {
  idempotencyKey: string;
  fromAccountId: string;
  toAccountId: string;
  sourceAmountMinor: string;
  destinationAmountMinor: string;
  transactionDate: string;
  description: string;
};

export type GoalInput = {
  idempotencyKey?: string;
  name: string;
  description: string | null;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  targetDate: string;
  linkedAccountId: string | null;
  icon: string;
  status: string;
  priority: number;
  assumedAnnualReturn: number;
  plannedContribution: string;
  frequency: string;
  planStartDate: string;
  planEndDate: string;
};

export type GoalMilestoneInput = {
  name: string;
  targetAmount: string;
  targetDate: string;
};

export type InstrumentInput = {
  externalId: string;
  name: string;
  symbol: string;
  identifierType: "isin" | "ticker_exchange" | "custom";
  identifier: string;
  exchangeMic: string;
  assetType: "stock" | "etf" | "fund";
  quoteCurrency: string;
};

export type SecurityPriceInput = {
  instrumentId: string;
  externalId: string;
  price: string;
  effectiveDate: string;
  source: string;
  provenance: string;
};

export type PositionEventInput = {
  accountId: string;
  instrumentId: string;
  type: string;
  quantity: string;
  unitPrice: string;
  tradeCurrency: string;
  feeAmount: string;
  feeCurrency: string;
  cashEffect: string;
  appliedExchangeRate: string;
  openingCostBasis: string;
  tradeDate: string;
  settlementDate: string;
  externalId: string;
  idempotencyKey: string;
  description: string;
  notes: string;
};

export type PositionReconciliationInput = {
  accountId: string;
  observationDate: string;
  reportedCash: string;
  reportedTotal: string;
  notes: string;
};

export type AccountConversionHoldingInput = {
  instrumentId: string;
  quantity: string;
  price: string;
  openingCostBasis: string;
  priceSource: string;
  priceProvenance: string;
};

export type AccountConversionInput = {
  sourceAccountId: string;
  targetName: string;
  conversionDate: string;
  openingCash: string;
  holdings: AccountConversionHoldingInput[];
  idempotencyKey: string;
  confirmDifference: boolean;
};

export type AccountConversionPreview = {
  sourceAccountId: string;
  sourceAccountName: string;
  currency: string;
  conversionDate: string;
  sourceBalanceMinor: string;
  openingCashMinor: string;
  positionsMinor: string;
  projectedTotalMinor: string;
  differenceMinor: string;
  holdings: Array<{
    instrumentId: string;
    name: string;
    symbol: string | null;
    quantity: string;
    price: string;
    quoteCurrency: string;
  }>;
};

export type AccountConversionResult = {
  targetAccountId: string;
  replayed: boolean;
};
