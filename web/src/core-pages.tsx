import { Landmark } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  getAccount,
  getAccountActivity,
  getAccountPositionEvents,
  getAccountPositionReconciliations,
  getAccounts,
  getAccountTransactions,
  getAccountValuations,
  getDashboard,
  getGoal,
  getGoalAlerts,
  getGoalMilestones,
  getGoals,
  getCategories,
  getInstitutions,
  getInstruments,
  getReportAllocation,
  getReportSummary,
  getTransactions,
} from "./api";
import {
  AccountControls,
  AccountConversionForm,
  AccountCreateForm,
  LedgerManager,
  PositionTools,
} from "./ledger-forms";
import { GoalForm, GoalManager } from "./planning-forms";
import {
  CorporateActionsPanel,
  ImportWorkspace,
} from "./advanced-account-workflows";
import { MoneyValue } from "./privacy";
import type {
  Account,
  ActivityItem,
  Goal,
  Transaction,
  Valuation,
  Session,
} from "./types";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  formatDate,
  humanize,
  KeyValue,
  PageHeader,
  ResourceView,
} from "./ui";
import { useResource } from "./use-resource";

export function DashboardPage() {
  const state = useResource(() => Promise.all([getDashboard(), getAccounts()]));
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Dashboard"
        description="What you own, owe, and are building toward."
      />
      <ResourceView state={state}>
        {([dashboard, accounts]) => (
          <>
            {!dashboard.currentComplete ? (
              <div className="notice warning">
                Some values need exchange rates:{" "}
                {dashboard.missingCurrencies.join(", ")}.
              </div>
            ) : null}
            <section className="net-worth-band">
              <div>
                <span>Total net worth</span>
                <strong>
                  <MoneyValue
                    amount={dashboard.totals.netWorth}
                    currency={dashboard.baseCurrency}
                  />
                </strong>
                <small>
                  {dashboard.accountCount} active accounts ·{" "}
                  {dashboard.goalCount} active goals
                </small>
              </div>
            </section>
            <section className="metric-grid" aria-label="Portfolio totals">
              <Metric
                label="Assets"
                amount={dashboard.totals.assets}
                currency={dashboard.baseCurrency}
              />
              <Metric
                label="Liabilities"
                amount={dashboard.totals.liabilities}
                currency={dashboard.baseCurrency}
              />
              <Metric
                label="Liquid"
                amount={dashboard.totals.liquid}
                currency={dashboard.baseCurrency}
              />
              <Metric
                label="Investible"
                amount={dashboard.totals.investible}
                currency={dashboard.baseCurrency}
              />
            </section>
            <section className="section-block">
              <div className="section-heading">
                <h2>Accounts</h2>
                <Link to="/accounts">View all</Link>
              </div>
              <AccountList accounts={accounts.items.slice(0, 5)} />
            </section>
          </>
        )}
      </ResourceView>
    </>
  );
}

export function AccountsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () => Promise.all([getAccounts(), getCategories(), getInstitutions()]),
    [refresh],
  );
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Accounts"
        description="Current balances across active financial accounts."
      />
      <ResourceView state={state}>
        {([accounts, categories, institutions]) => (
          <div className="settings-stack">
            <AccountCreateForm
              categories={categories.items}
              institutions={institutions.items}
              session={session}
              onChanged={() => setRefresh((value) => value + 1)}
            />
            <AccountList accounts={accounts.items} />
          </div>
        )}
      </ResourceView>
    </>
  );
}

function AccountList({ accounts }: { accounts: Account[] }) {
  if (!accounts.length)
    return (
      <EmptyState
        title="No accounts yet"
        description="Your account list will appear here."
      />
    );
  return (
    <div className="account-list">
      {accounts.map((account) => (
        <Link
          className="account-row"
          to={`/accounts/${account.id}`}
          key={account.id}
        >
          <div className="account-icon">
            <Landmark />
          </div>
          <div className="account-main">
            <strong>{account.name}</strong>
            <span>{account.institutionName || account.categoryName}</span>
          </div>
          <div className="account-value">
            <strong>
              <MoneyValue
                amount={account.currentValueMinor}
                currency={account.currency}
              />
            </strong>
            <span>
              {account.isLiability ? "Liability" : account.categoryName}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function AccountDetailPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () =>
      Promise.all([
        getAccount(id),
        getAccountActivity(id),
        getAccountTransactions(id),
        getAccountValuations(id),
        getAccounts(),
        getCategories(),
        getInstitutions(),
        getInstruments(),
        getAccountPositionEvents(id),
        getAccountPositionReconciliations(id),
      ]),
    [id, refresh],
  );
  return (
    <ResourceView state={state} loadingLabel="Loading account...">
      {([
        account,
        activity,
        transactions,
        valuations,
        accounts,
        categories,
        institutions,
        instruments,
        positionEvents,
        positionReconciliations,
      ]) => (
        <>
          <PageHeader
            eyebrow="Account"
            title={account.name}
            description={[account.institutionName, account.categoryName]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <Link className="secondary-button" to="/accounts">
                All accounts
              </Link>
            }
          />
          <div className="metric-grid">
            <Metric
              label={account.isLiability ? "Amount owed" : "Current value"}
              amount={account.currentValueMinor}
              currency={account.currency}
            />
            {account.costBasisMinor ? (
              <Metric
                label="Cost basis"
                amount={account.costBasisMinor}
                currency={account.currency}
              />
            ) : null}
            <TextMetric
              label="Tracking"
              value={humanize(account.trackingMode)}
            />
            <TextMetric
              label="Net worth"
              value={account.isIncludedInNetWorth ? "Included" : "Excluded"}
            />
          </div>
          <div className="detail-grid">
            <ActivityCard title="Combined activity" items={activity.items} />
            <TransactionCard title="Transactions" items={transactions.items} />
            <ValuationCard items={valuations.items} />
          </div>
          <AccountControls
            account={account}
            categories={categories.items}
            institutions={institutions.items}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
          <LedgerManager
            account={account}
            transactions={transactions.items}
            valuations={valuations.items}
            allAccounts={accounts.items}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
          {account.trackingMode === "positions" ? (
            <>
              <PositionTools
                account={account}
                instruments={instruments.instruments}
                events={positionEvents.items}
                reconciliations={positionReconciliations.items}
                session={session}
                onChanged={() => setRefresh((value) => value + 1)}
              />
              <CorporateActionsPanel
                account={account}
                accounts={accounts.items}
                instruments={instruments.instruments}
                events={positionEvents.items}
                session={session}
                onChanged={() => setRefresh((value) => value + 1)}
              />
            </>
          ) : (
            <AccountConversionForm
              account={account}
              instruments={instruments.instruments}
              session={session}
              onConverted={(targetID) => navigate(`/accounts/${targetID}`)}
            />
          )}
          <ImportWorkspace
            account={account}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        </>
      )}
    </ResourceView>
  );
}

export function TransactionsPage() {
  const state = useResource(getTransactions);
  return (
    <>
      <PageHeader
        eyebrow="Activity"
        title="Transactions"
        description="Recorded cash flows across all accounts."
      />
      <ResourceView state={state}>
        {({ items }) => (
          <TransactionCard title="All transactions" items={items} />
        )}
      </ResourceView>
    </>
  );
}

function TransactionCard({
  title,
  items,
}: {
  title: string;
  items: Transaction[];
}) {
  return (
    <Card>
      <CardHeader title={title} description="Newest activity first" />
      {items.length ? (
        <div className="data-list">
          {items.map((item) => (
            <div className="data-row" key={item.id}>
              <div>
                <strong>{humanize(item.type)}</strong>
                <span>
                  {item.accountName} · {formatDate(item.transactionDate)}
                  {item.description ? ` · ${item.description}` : ""}
                </span>
              </div>
              <MoneyValue amount={item.amountMinor} currency={item.currency} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No transactions"
          description="No transaction records match this view."
        />
      )}
    </Card>
  );
}

function ActivityCard({
  title,
  items,
}: {
  title: string;
  items: ActivityItem[];
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {items.length ? (
        <div className="data-list">
          {items.map((item) => (
            <div className="data-row" key={`${item.kind}-${item.id}`}>
              <div>
                <strong>{humanize(item.type)}</strong>
                <span>
                  {humanize(item.kind)} · {formatDate(item.date)}
                </span>
              </div>
              <MoneyValue amount={item.amountMinor} currency={item.currency} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No activity"
          description="This account has no activity yet."
        />
      )}
    </Card>
  );
}

function ValuationCard({ items }: { items: Valuation[] }) {
  return (
    <Card>
      <CardHeader title="Valuations" />
      {items.length ? (
        <div className="data-list">
          {items.map((item) => (
            <div className="data-row" key={item.id}>
              <div>
                <strong>{formatDate(item.valuationDate)}</strong>
                <span>{item.notes || "Recorded valuation"}</span>
              </div>
              <MoneyValue amount={item.valueMinor} currency={item.currency} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No valuations"
          description="This account has no valuation snapshots."
        />
      )}
    </Card>
  );
}

export function GoalsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () => Promise.all([getGoals(), getGoalAlerts(), getAccounts()]),
    [refresh],
  );
  return (
    <>
      <PageHeader
        eyebrow="Planning"
        title="Financial goals"
        description="Linked balances, target dates, and contribution plans."
      />
      <ResourceView state={state}>
        {([goals, alerts, accounts]) => (
          <>
            <Card>
              <CardHeader title="Create financial goal" />
              <GoalForm
                accounts={accounts.items}
                session={session}
                onChanged={() => setRefresh((value) => value + 1)}
              />
            </Card>
            {alerts.length ? (
              <div className="notice warning">
                {alerts.length} goal alert{alerts.length === 1 ? "" : "s"} need
                attention.
              </div>
            ) : null}
            {goals.length ? (
              <div className="card-grid">
                {goals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No goals yet"
                description="Goals will appear here when configured."
              />
            )}
          </>
        )}
      </ResourceView>
    </>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const progress = Math.max(0, Math.min(100, Number(goal.progressPercent)));
  return (
    <Link className="read-card linked-card" to={`/goals/${goal.id}`}>
      <CardHeader
        title={goal.name}
        description={goal.linkedAccount?.name || "Directly tracked goal"}
        aside={
          <Badge tone={goal.valueIncomplete ? "warning" : "positive"}>
            {humanize(goal.status)}
          </Badge>
        }
      />
      <div className="goal-values">
        <MoneyValue
          amount={goal.currentAmountMinor}
          currency={goal.currentAmountCurrency}
        />
        <span>
          of{" "}
          <MoneyValue
            amount={goal.targetAmountMinor}
            currency={goal.currency}
          />
        </span>
      </div>
      <div className="progress-track" aria-label={`${goal.name} progress`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="read-note">
        {goal.progressPercent}% · target {formatDate(goal.targetDate)}
      </p>
    </Link>
  );
}

export function GoalDetailPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const [refresh, setRefresh] = useState(0);
  const state = useResource(
    () => Promise.all([getGoal(id), getGoalMilestones(id), getAccounts()]),
    [id, refresh],
  );
  return (
    <ResourceView state={state} loadingLabel="Loading goal...">
      {([goal, milestones, accounts]) => (
        <>
          <PageHeader
            eyebrow="Goal"
            title={goal.name}
            description={
              goal.description || `Target date ${formatDate(goal.targetDate)}`
            }
            actions={
              <Link className="secondary-button" to="/goals">
                All goals
              </Link>
            }
          />
          <div className="metric-grid">
            <Metric
              label="Current"
              amount={goal.currentAmountMinor}
              currency={goal.currentAmountCurrency}
            />
            <Metric
              label="Target"
              amount={goal.targetAmountMinor}
              currency={goal.currency}
            />
            {goal.plan ? (
              <Metric
                label={`${humanize(goal.plan.frequency)} plan`}
                amount={goal.plan.plannedContributionMinor}
                currency={goal.currency}
              />
            ) : null}
            <TextMetric label="Progress" value={`${goal.progressPercent}%`} />
          </div>
          <Card className="section-block">
            <CardHeader title="Milestones" />
            {milestones.length ? (
              <div className="data-list">
                {milestones.map((item) => (
                  <div className="data-row" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.progressPercent}% ·{" "}
                        {item.targetDate
                          ? formatDate(item.targetDate)
                          : "No date"}
                      </span>
                    </div>
                    <MoneyValue
                      amount={item.targetAmountMinor}
                      currency={goal.currency}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No milestones"
                description="This goal has no milestones."
              />
            )}
          </Card>
          <GoalManager
            goal={goal}
            milestones={milestones}
            accounts={accounts.items}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        </>
      )}
    </ResourceView>
  );
}

export function ReportsPage() {
  const state = useResource(() =>
    Promise.all([getReportSummary(), getReportAllocation()]),
  );
  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Reports & analytics"
        description="Current totals and allocation across your portfolio."
      />
      <ResourceView state={state}>
        {([summary, allocation]) => (
          <>
            {!summary.currentComplete ? (
              <div className="notice warning">
                Some allocations need exchange rates:{" "}
                {summary.missingCurrencies.join(", ")}.
              </div>
            ) : null}
            <div className="metric-grid">
              <Metric
                label="Net worth"
                amount={summary.totals.netWorth}
                currency={summary.baseCurrency}
              />
              <Metric
                label="Assets"
                amount={summary.totals.assets}
                currency={summary.baseCurrency}
              />
              <Metric
                label="Liabilities"
                amount={summary.totals.liabilities}
                currency={summary.baseCurrency}
              />
              <TextMetric label="As of" value={formatDate(summary.asOf)} />
            </div>
            <div className="detail-grid reports-grid">
              <AllocationCard
                title="By category"
                items={allocation.categories}
                currency={allocation.baseCurrency}
              />
              <AllocationCard
                title="By institution"
                items={allocation.institutions}
                currency={allocation.baseCurrency}
              />
              <AllocationCard
                title="By currency"
                items={allocation.currencies}
                currency={allocation.baseCurrency}
              />
            </div>
          </>
        )}
      </ResourceView>
    </>
  );
}

function AllocationCard({
  title,
  items,
  currency,
}: {
  title: string;
  items: { name: string; valueMinor: string; sharePercent: string }[];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {items.length ? (
        <div className="data-list">
          {items.map((item) => (
            <div className="data-row" key={item.name}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.sharePercent}%</span>
              </div>
              <MoneyValue amount={item.valueMinor} currency={currency} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No allocation"
          description="No values are available for this grouping."
        />
      )}
    </Card>
  );
}

function Metric({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: string;
  currency: string;
}) {
  return (
    <Card className="metric">
      <span>{label}</span>
      <strong>
        <MoneyValue amount={amount} currency={currency} />
      </strong>
    </Card>
  );
}

function TextMetric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="metric">
      <KeyValue label={label}>{value}</KeyValue>
    </Card>
  );
}
