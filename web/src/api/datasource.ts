/**
 * Typed data-access interface mirroring the Wealthboard API resources.
 * Two implementations exist: the mock adapter (default) and the HTTP adapter (`/api/v1`).
 */
import type {
  AccountComparison,
  AccountExtras,
  AccountSummaryExt,
  ActivityQuery,
  AttentionSummary,
  FlowsReport,
  IncomeReport,
  InstrumentHoldings,
  NetWorthStats,
} from './extensions'
import type {
  APIKeyMetadata,
  ConnectedApp,
  OAuthConsentRequest,
  OAuthDataLevel,
  AccountConversionPreview,
  AccountConversionRequest,
  AccountConversionResult,
  BeneficiaryInput,
  CorporateActionKind,
  CorporateActionRequest,
  CreateAPIKeyRequest,
  CreatedAPIKey,
  EnableLocalCredentialRequest,
  EstateAllocationInput,
  EstateDirectiveInput,
  EstatePlan,
  EstatePlanInput,
  EstateSnapshot,
  EstateWorkspace,
  InvestmentHistoryImportResult,
  PositionEvent,
  PositionEventUpdateRequest,
  PositionReconciliationCreateRequest,
  PositionReconciliationPage,
  Account,
  AccountAnalytics,
  AccountCreateRequest,
  AccountHistoryImportResult,
  AccountUpdateRequest,
  ActivityPage,
  AuthConfig,
  Category,
  CategoryMutationRequest,
  ChangePasswordRequest,
  Dashboard,
  DashboardRange,
  ExchangeRate,
  ExchangeRateMutationRequest,
  Goal,
  GoalAlert,
  GoalMilestone,
  GoalMilestoneCreateRequest,
  GoalMutationRequest,
  GoalMutationResult,
  GoalScenarios,
  GoalStatus,
  Institution,
  InstitutionMutationRequest,
  Instrument,
  InstrumentDetail,
  InstrumentMutationRequest,
  LoginRequest,
  PositionEventCreateRequest,
  PositionEventPage,
  ReportAllocation,
  ReportSummary,
  ResourceIDResponse,
  RestoreSummary,
  SecurityPriceMutationRequest,
  SessionResponse,
  SettingsMutationRequest,
  SettingsRead,
  SignupRequest,
  TransactionCreateRequest,
  TransactionPage,
  TransactionUpdateRequest,
  TransferCreateRequest,
  UserArchive,
  ValuationCreateRequest,
  ValuationPage,
} from './types'

export interface PageQuery {
  limit?: number
  offset?: number
  from?: string
  to?: string
}

export interface ImportFile {
  name: string
  /** File text (CSV or JSON). */
  content: string
  format: 'csv' | 'json'
}

/** Options that apply to financial mutations: one idempotency key per submission attempt. */
export interface MutationOptions {
  idempotencyKey: string
}

export interface DataSource {
  readonly kind: 'mock' | 'http'

  auth: {
    config(): Promise<AuthConfig>
    /** Bootstraps the session; resolves null when signed out. */
    session(): Promise<SessionResponse | null>
    login(body: LoginRequest): Promise<SessionResponse>
    signup(body: SignupRequest): Promise<SessionResponse>
    logout(): Promise<void>
    changePassword(body: ChangePasswordRequest): Promise<void>
    /** URL to start the OIDC flow (browser navigates to it). */
    oidcStartUrl(next?: string): string
    /** Starts linking an OIDC identity (redirects the browser to the provider). */
    linkOidc(currentPassword: string): Promise<void>
    unlinkOidc(currentPassword: string): Promise<SessionResponse>
    /** Re-authenticates with the OIDC provider before a sensitive change (redirects the browser). */
    reauthenticateOidc(next?: string): Promise<void>
    enableLocalCredential(body: EnableLocalCredentialRequest): Promise<SessionResponse>
    removeLocalCredential(): Promise<SessionResponse>
    /** Mock adapter only: completes the simulated OIDC round trip. */
    completeMockOidc?(): Promise<SessionResponse>
  }

  dashboard: {
    get(range: DashboardRange): Promise<Dashboard>
  }

  accounts: {
    list(archived?: 'active' | 'archived' | 'all'): Promise<Account[]>
    summaries(): Promise<AccountSummaryExt[]>
    get(id: string): Promise<Account>
    create(body: AccountCreateRequest): Promise<ResourceIDResponse>
    update(id: string, body: AccountUpdateRequest): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    remove(id: string, confirmationName: string): Promise<void>
    analytics(id: string): Promise<AccountAnalytics>
    extras(id: string): Promise<AccountExtras>
    activity(id: string, query?: PageQuery): Promise<ActivityPage>
    transactions(id: string, query?: PageQuery): Promise<TransactionPage>
    valuations(id: string, query?: PageQuery): Promise<ValuationPage>
    positionEvents(id: string, query?: PageQuery): Promise<PositionEventPage>
  }

  activity: {
    list(query: ActivityQuery): Promise<ActivityPage>
  }

  transactions: {
    create(body: TransactionCreateRequest): Promise<ResourceIDResponse>
    update(id: string, body: TransactionUpdateRequest): Promise<void>
    remove(id: string): Promise<void>
  }

  valuations: {
    create(body: ValuationCreateRequest): Promise<ResourceIDResponse>
    remove(id: string): Promise<void>
  }

  transfers: {
    create(body: TransferCreateRequest): Promise<ResourceIDResponse>
  }

  instruments: {
    list(): Promise<Instrument[]>
    get(id: string): Promise<InstrumentDetail>
    holdings(id: string): Promise<InstrumentHoldings>
    create(body: InstrumentMutationRequest): Promise<ResourceIDResponse>
    update(id: string, body: InstrumentMutationRequest): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    /** Permanently deletes an instrument that no trade, price, or import references (409 otherwise). */
    remove(id: string): Promise<void>
  }

  prices: {
    upsert(body: SecurityPriceMutationRequest, options: MutationOptions): Promise<ResourceIDResponse>
    remove(id: string): Promise<void>
  }

  positionEvents: {
    get(accountId: string, id: string): Promise<PositionEvent>
    create(body: PositionEventCreateRequest): Promise<ResourceIDResponse>
    update(id: string, body: PositionEventUpdateRequest): Promise<ResourceIDResponse>
    remove(id: string): Promise<void>
  }

  reconciliations: {
    list(accountId: string, query?: PageQuery): Promise<PositionReconciliationPage>
    create(body: PositionReconciliationCreateRequest): Promise<ResourceIDResponse>
    remove(id: string): Promise<void>
  }

  conversions: {
    preview(body: AccountConversionRequest, options: MutationOptions): Promise<AccountConversionPreview>
    execute(body: AccountConversionRequest, options: MutationOptions): Promise<AccountConversionResult>
  }

  corporateActions: {
    create(kind: CorporateActionKind, body: CorporateActionRequest, options: MutationOptions): Promise<{ eventGroupId: string }>
    /** Undoes a whole corporate action, identified by its event group ID or any member event ID. */
    remove(id: string): Promise<void>
  }

  estate: {
    get(): Promise<EstateWorkspace>
    updatePlan(body: EstatePlanInput): Promise<EstatePlan>
    createBeneficiary(body: BeneficiaryInput): Promise<ResourceIDResponse>
    updateBeneficiary(id: string, body: BeneficiaryInput): Promise<void>
    setBeneficiaryArchived(id: string, archived: boolean): Promise<void>
    /** Upserts how one account is held and distributed (`accountId` is the directive key). */
    upsertDirective(accountId: string, body: EstateDirectiveInput): Promise<ResourceIDResponse>
    upsertAllocation(directiveId: string, body: EstateAllocationInput): Promise<ResourceIDResponse>
    removeAllocation(id: string): Promise<void>
    upsertResiduary(body: EstateAllocationInput): Promise<ResourceIDResponse>
    removeResiduary(id: string): Promise<void>
    createSnapshot(): Promise<EstateSnapshot>
    getSnapshot(id: string): Promise<EstateSnapshot>
    removeSnapshot(id: string): Promise<void>
  }

  apiKeys: {
    list(): Promise<APIKeyMetadata[]>
    /** The token is returned once, at creation. */
    create(body: CreateAPIKeyRequest): Promise<CreatedAPIKey>
    revoke(id: string): Promise<void>
    revokeAll(): Promise<{ revoked: number }>
  }

  /** AI assistants connected to the MCP endpoint with OAuth. Browser session only. */
  connectedApps: {
    list(): Promise<ConnectedApp[]>
    revoke(id: string): Promise<void>
    clearCalls(id: string): Promise<void>
  }

  /** The consent step of an assistant's OAuth sign-in. */
  oauth: {
    request(id: string): Promise<OAuthConsentRequest>
    /** `allowChanges` grants portfolio:write; the server accepts it only for detailed access the application requested. */
    approve(id: string, dataLevel: OAuthDataLevel, allowChanges: boolean): Promise<{ redirectTo: string }>
    deny(id: string): Promise<{ redirectTo: string }>
  }

  goals: {
    list(): Promise<Goal[]>
    get(id: string): Promise<Goal>
    create(body: GoalMutationRequest, options: MutationOptions): Promise<GoalMutationResult>
    update(id: string, body: GoalMutationRequest): Promise<void>
    remove(id: string): Promise<void>
    setStatus(id: string, status: GoalStatus): Promise<void>
    /** What-if scenarios. Never saves to the goal. */
    scenarios(id: string, params: { monthlyContributionMinor: string; annualReturnBps: number }): Promise<GoalScenarios>
    milestones(id: string): Promise<GoalMilestone[]>
    createMilestone(id: string, body: GoalMilestoneCreateRequest): Promise<ResourceIDResponse>
    removeMilestone(id: string, milestoneId: string): Promise<void>
    alerts(): Promise<GoalAlert[]>
    dismissAlert(id: string): Promise<void>
  }

  reports: {
    summary(): Promise<ReportSummary>
    allocation(): Promise<ReportAllocation>
    flows(range: DashboardRange): Promise<FlowsReport>
    income(range: DashboardRange): Promise<IncomeReport>
    netWorthStats(): Promise<NetWorthStats>
    accountComparison(range: DashboardRange): Promise<AccountComparison>
    attention(): Promise<AttentionSummary>
  }

  settings: {
    get(): Promise<SettingsRead>
    update(body: SettingsMutationRequest): Promise<void>
  }

  categories: {
    list(): Promise<Category[]>
    create(body: CategoryMutationRequest): Promise<Category>
    update(id: string, body: CategoryMutationRequest): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    reorder(id: string, direction: 'up' | 'down'): Promise<void>
  }

  institutions: {
    list(): Promise<Institution[]>
    create(body: InstitutionMutationRequest): Promise<ResourceIDResponse>
    update(id: string, body: InstitutionMutationRequest): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
  }

  exchangeRates: {
    create(body: ExchangeRateMutationRequest, options: MutationOptions): Promise<ExchangeRate>
    remove(id: string): Promise<void>
  }

  imports: {
    previewAccountHistory(accountId: string, file: ImportFile): Promise<AccountHistoryImportResult>
    /** Commits exactly the previewed content; `hash` is the SHA-256 the preview returned. */
    commitAccountHistory(accountId: string, file: ImportFile, hash: string): Promise<AccountHistoryImportResult>
    previewInvestmentHistory(accountId: string, file: ImportFile): Promise<InvestmentHistoryImportResult>
    commitInvestmentHistory(accountId: string, file: ImportFile, hash: string): Promise<InvestmentHistoryImportResult>
  }

  exports: {
    userArchive(): Promise<UserArchive>
    transactionsCsv(): Promise<string>
    accountsCsv(): Promise<string>
    restore(archive: UserArchive): Promise<RestoreSummary>
    /** Restores from the raw export file (multipart upload, exactly as exported). */
    restoreFile(file: File): Promise<RestoreSummary>
  }
}
