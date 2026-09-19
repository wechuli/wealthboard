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
