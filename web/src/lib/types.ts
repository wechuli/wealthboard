import type { components, operations } from "@/api/schema";

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
export type GoalScenarios = components["schemas"]["GoalScenarios"];
export type GoalMilestone = components["schemas"]["GoalMilestone"];
export type GoalAlert = components["schemas"]["GoalAlert"];

export type Dashboard = components["schemas"]["Dashboard"];
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportAllocation = components["schemas"]["ReportAllocation"];
export type AccountAnalytics = components["schemas"]["AccountAnalytics"];
export type AccountPosition = components["schemas"]["AccountPosition"];
export type AccountPositionSummary =
  components["schemas"]["AccountPositionSummary"];

export type SecurityPrice = components["schemas"]["SecurityPrice"];
export type Instrument = components["schemas"]["Instrument"];
export type InstrumentDetail = components["schemas"]["InstrumentDetail"];
export type InstrumentList = OperationJsonResponse<"listInstruments", 200>;
export type PositionEvent = components["schemas"]["PositionEvent"];
export type PositionEventPage = components["schemas"]["PositionEventPage"];
export type PositionReconciliation =
  components["schemas"]["PositionReconciliation"];
export type PositionReconciliationPage =
  components["schemas"]["PositionReconciliationPage"];

export type SettingsRead = components["schemas"]["SettingsRead"];

export type EstateWorkspace = components["schemas"]["EstateWorkspace"];
export type EstateSnapshot = components["schemas"]["EstateSnapshot"];

export type AIRead = components["schemas"]["AIRead"];

export type APIKeyList = OperationJsonResponse<"listApiKeys", 200>;
export type Problem =
  components["responses"]["Problem"]["content"]["application/problem+json"];

export type MutationID = components["schemas"]["ResourceIDResponse"];
export type MutationStatus = components["schemas"]["MutationStatusResponse"];
export type SettingsInput = components["schemas"]["SettingsMutationRequest"];
export type CategoryInput = components["schemas"]["CategoryMutationRequest"];
export type InstitutionInput =
  components["schemas"]["InstitutionMutationRequest"];
export type ExchangeRateInput =
  components["schemas"]["ExchangeRateMutationRequest"];

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

export type ValuationInput = components["schemas"]["ValuationCreateRequest"];
export type TransferInput = components["schemas"]["TransferCreateRequest"];

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

export type GoalMilestoneInput =
  components["schemas"]["GoalMilestoneCreateRequest"];
export type InstrumentInput =
  components["schemas"]["InstrumentMutationRequest"];
export type SecurityPriceInput =
  components["schemas"]["SecurityPriceMutationRequest"];
export type PositionEventInput =
  components["schemas"]["PositionEventCreateRequest"];
export type PositionReconciliationInput =
  components["schemas"]["PositionReconciliationCreateRequest"];

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

export type AccountConversionPreview =
  components["schemas"]["AccountConversionPreview"];
export type AccountConversionResult =
  components["schemas"]["AccountConversionResult"];

export type CorporateActionInput =
  | components["schemas"]["StockSplitRequest"]
  | components["schemas"]["SpinoffRequest"]
  | components["schemas"]["MergerRequest"]
  | components["schemas"]["DividendReinvestmentRequest"]
  | components["schemas"]["InKindTransferRequest"];
export type AccountHistoryImportResult =
  components["schemas"]["AccountHistoryImportResult"];
export type InvestmentHistoryImportResult =
  components["schemas"]["InvestmentHistoryImportResult"];
export type ImportResult =
  | AccountHistoryImportResult
  | InvestmentHistoryImportResult;
export type RestoreSummary = components["schemas"]["RestoreSummary"];
export type EstatePlanInput = components["schemas"]["EstatePlanInput"];
export type BeneficiaryInput = components["schemas"]["BeneficiaryInput"];
export type EstateDirectiveInput =
  components["schemas"]["EstateDirectiveInput"];
export type EstateAllocationInput =
  components["schemas"]["EstateAllocationInput"];
export type AISettingsInput = components["schemas"]["AISettingsInput"];
export type AISource = components["schemas"]["AISource"];
export type AIConversionDraft = components["schemas"]["AIConversionDraft"];
