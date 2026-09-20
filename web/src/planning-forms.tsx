import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  archiveInstrument,
  createGoal,
  createInstrument,
  createMilestone,
  deleteGoal,
  deleteInstrument,
  deleteMilestone,
  deleteSecurityPrice,
  setGoalStatus,
  updateGoal,
  updateInstrument,
  upsertSecurityPrice,
} from "./api";
import type {
  Account,
  Goal,
  GoalInput,
  GoalMilestone,
  Instrument,
  InstrumentInput,
  SecurityPrice,
  Session,
} from "./types";
import { MoneyValue } from "./privacy";
import { Card, CardHeader } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);
const goalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  targetAmount: z.string().min(1),
  currentAmount: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  targetDate: z.iso.date(),
  linkedAccountId: z.string(),
  status: z.enum(["active", "paused", "completed", "cancelled"]),
  assumedAnnualReturn: z.number().min(0).max(100),
  plannedContribution: z.string(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "annually", "custom"]),
  planStartDate: z.iso.date(),
  planEndDate: z.string(),
});
type GoalValues = z.infer<typeof goalSchema>;

function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}

export function GoalForm({
  accounts,
  session,
  onChanged,
  goal,
}: {
  accounts: Account[];
  session: Session;
  onChanged: () => void;
  goal?: Goal;
}) {
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<GoalValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: goal
      ? {
          name: goal.name,
          description: goal.description ?? "",
          targetAmount: String(Number(goal.targetAmountMinor) / 100),
          currentAmount: String(Number(goal.currentAmountMinor) / 100),
          currency: goal.currency,
          targetDate: goal.targetDate,
          linkedAccountId: goal.linkedAccount?.id ?? "",
          status: goal.status as GoalValues["status"],
          assumedAnnualReturn: Number(goal.assumedAnnualReturnBps) / 100,
          plannedContribution: String(
            Number(goal.plan?.plannedContributionMinor ?? "0") / 100,
          ),
          frequency: (goal.plan?.frequency ??
            "monthly") as GoalValues["frequency"],
          planStartDate: goal.plan?.startDate ?? today(),
          planEndDate: goal.plan?.endDate ?? "",
        }
      : {
          name: "",
          description: "",
          targetAmount: "",
          currentAmount: "0",
          currency: "KES",
          targetDate: "",
          linkedAccountId: "",
          status: "active",
          assumedAnnualReturn: 8,
          plannedContribution: "0",
          frequency: "monthly",
          planStartDate: today(),
          planEndDate: "",
        },
  });
  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit(async (values) => {
        setError("");
        const input: GoalInput = {
          idempotencyKey: goal ? undefined : key,
          name: values.name,
          description: values.description || null,
          targetAmount: values.targetAmount,
          currentAmount: values.currentAmount || "0",
          currency: values.currency,
          targetDate: values.targetDate,
          linkedAccountId: values.linkedAccountId || null,
          icon: "Target",
          status: values.status,
          priority: 0,
          assumedAnnualReturn: values.assumedAnnualReturn,
          plannedContribution: values.plannedContribution || "0",
          frequency: values.frequency,
          planStartDate: values.planStartDate,
          planEndDate: values.planEndDate,
        };
        try {
          if (goal) await updateGoal(goal.id, input, session.csrfToken);
          else await createGoal(input, session.csrfToken);
          if (!goal) {
            reset();
            setKey(crypto.randomUUID());
          }
          onChanged();
        } catch (caught) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The goal could not be saved.",
          );
        }
      })}
    >
      <ErrorNotice message={error} />
      <div className="form-grid">
        <div>
          <label htmlFor={`goal-name-${goal?.id ?? "new"}`}>Goal name</label>
          <input id={`goal-name-${goal?.id ?? "new"}`} {...register("name")} />
        </div>
        <div>
          <label htmlFor={`goal-target-${goal?.id ?? "new"}`}>
            Target amount
          </label>
          <input
            id={`goal-target-${goal?.id ?? "new"}`}
            inputMode="decimal"
            {...register("targetAmount")}
          />
        </div>
        <div>
          <label htmlFor={`goal-currency-${goal?.id ?? "new"}`}>Currency</label>
          <input
            id={`goal-currency-${goal?.id ?? "new"}`}
            maxLength={3}
            {...register("currency")}
          />
        </div>
        <div>
          <label htmlFor={`goal-date-${goal?.id ?? "new"}`}>Target date</label>
          <input
            id={`goal-date-${goal?.id ?? "new"}`}
            type="date"
            {...register("targetDate")}
          />
        </div>
        <div>
          <label htmlFor={`goal-account-${goal?.id ?? "new"}`}>
            Linked account
          </label>
          <select
            id={`goal-account-${goal?.id ?? "new"}`}
            {...register("linkedAccountId")}
          >
            <option value="">No linked account</option>
            {accounts
              .filter((account) => !account.isLiability && !account.archivedAt)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor={`goal-current-${goal?.id ?? "new"}`}>
            Current amount
          </label>
          <input
            id={`goal-current-${goal?.id ?? "new"}`}
            inputMode="decimal"
            {...register("currentAmount")}
          />
        </div>
        <div>
          <label htmlFor={`goal-contribution-${goal?.id ?? "new"}`}>
            Planned contribution
          </label>
          <input
            id={`goal-contribution-${goal?.id ?? "new"}`}
            inputMode="decimal"
            {...register("plannedContribution")}
          />
        </div>
        <div>
          <label htmlFor={`goal-frequency-${goal?.id ?? "new"}`}>
            Contribution frequency
          </label>
          <select
            id={`goal-frequency-${goal?.id ?? "new"}`}
            {...register("frequency")}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label htmlFor={`goal-start-${goal?.id ?? "new"}`}>Plan start</label>
          <input
            id={`goal-start-${goal?.id ?? "new"}`}
            type="date"
            {...register("planStartDate")}
          />
        </div>
        <div>
          <label htmlFor={`goal-end-${goal?.id ?? "new"}`}>Plan end</label>
          <input
            id={`goal-end-${goal?.id ?? "new"}`}
            type="date"
            {...register("planEndDate")}
          />
        </div>
        <div>
          <label htmlFor={`goal-return-${goal?.id ?? "new"}`}>
            Assumed annual return (%)
          </label>
          <input
            id={`goal-return-${goal?.id ?? "new"}`}
            type="number"
            step="0.1"
            {...register("assumedAnnualReturn", { valueAsNumber: true })}
          />
        </div>
        <div>
          <label htmlFor={`goal-status-${goal?.id ?? "new"}`}>Status</label>
          <select
            id={`goal-status-${goal?.id ?? "new"}`}
            {...register("status")}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label htmlFor={`goal-description-${goal?.id ?? "new"}`}>
            Description
          </label>
          <input
            id={`goal-description-${goal?.id ?? "new"}`}
            {...register("description")}
          />
        </div>
      </div>
      <button className="primary-button compact" disabled={isSubmitting}>
        <Save size={16} />
        {isSubmitting ? "Saving..." : goal ? "Save goal" : "Create goal"}
      </button>
    </form>
  );
}

export function GoalManager({
  goal,
  milestones,
  accounts,
  session,
  onChanged,
}: {
  goal: Goal;
  milestones: GoalMilestone[];
  accounts: Account[];
  session: Session;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const milestoneSchema = z.object({
    name: z.string().trim().min(1).max(100),
    targetAmount: z.string().min(1),
    targetDate: z.string(),
  });
  const milestoneForm = useForm({
    resolver: zodResolver(milestoneSchema),
    defaultValues: { name: "", targetAmount: "", targetDate: "" },
  });
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The goal could not be changed.",
      );
    }
  };
  return (
    <div className="settings-stack section-block">
      <ErrorNotice message={error} />
      <Card>
        <CardHeader title="Manage goal" />
        <div className="page-actions">
          <button
            className="secondary-button"
            onClick={() => setEditing(!editing)}
          >
            <Save size={16} /> Edit
          </button>
          <select
            aria-label="Goal status"
            value={goal.status}
            onChange={(event) =>
              void run(() =>
                setGoalStatus(goal.id, event.target.value, session.csrfToken),
              )
            }
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            className="secondary-button danger-button"
            onClick={() => {
              if (window.confirm(`Delete ${goal.name}?`))
                void run(() =>
                  deleteGoal(goal.id, session.csrfToken).then(() =>
                    window.location.assign("/goals"),
                  ),
                );
            }}
          >
            <Trash2 size={16} /> Delete
          </button>
        </div>
        {editing ? (
          <GoalForm
            goal={goal}
            accounts={accounts}
            session={session}
            onChanged={onChanged}
          />
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Manage milestones" />
        <form
          className="auth-form"
          onSubmit={milestoneForm.handleSubmit(async (values) => {
            await run(() =>
              createMilestone(goal.id, values, session.csrfToken),
            );
            milestoneForm.reset();
          })}
        >
          <div className="form-grid">
            <div>
              <label htmlFor="milestone-name">Name</label>
              <input id="milestone-name" {...milestoneForm.register("name")} />
            </div>
            <div>
              <label htmlFor="milestone-target">Target amount</label>
              <input
                id="milestone-target"
                inputMode="decimal"
                {...milestoneForm.register("targetAmount")}
              />
            </div>
            <div>
              <label htmlFor="milestone-date">Target date</label>
              <input
                id="milestone-date"
                type="date"
                {...milestoneForm.register("targetDate")}
              />
            </div>
          </div>
          <button
            className="primary-button compact"
            disabled={milestoneForm.formState.isSubmitting}
          >
            <Plus size={16} /> Add milestone
          </button>
        </form>
        <div className="data-list">
          {milestones.map((milestone) => (
            <div className="data-row" key={milestone.id}>
              <div>
                <strong>{milestone.name}</strong>
                <span>{milestone.targetDate || "No date"}</span>
              </div>
              <div className="page-actions">
                <MoneyValue
                  amount={milestone.targetAmountMinor}
                  currency={goal.currency}
                />
                <button
                  className="icon-button"
                  aria-label={`Delete ${milestone.name} milestone`}
                  onClick={() => {
                    if (window.confirm(`Delete ${milestone.name}?`))
                      void run(() =>
                        deleteMilestone(
                          goal.id,
                          milestone.id,
                          session.csrfToken,
                        ),
                      );
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const instrumentSchema = z.object({
  externalId: z.string().max(200),
  name: z.string().trim().min(1).max(100),
  symbol: z.string().max(30),
  identifierType: z.enum(["isin", "ticker_exchange", "custom"]),
  identifier: z.string().max(100),
  exchangeMic: z.string().max(20),
  assetType: z.enum(["stock", "etf", "fund"]),
  quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
});
export function InstrumentForm({
  session,
  onChanged,
  instrument,
}: {
  session: Session;
  onChanged: () => void;
  instrument?: Instrument;
}) {
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<InstrumentInput>({
    resolver: zodResolver(instrumentSchema),
    defaultValues: instrument
      ? {
          externalId: instrument.externalId ?? "",
          name: instrument.name,
          symbol: instrument.symbol ?? "",
          identifierType:
            instrument.identifierType as InstrumentInput["identifierType"],
          identifier: instrument.identifier ?? "",
          exchangeMic: instrument.exchangeMic ?? "",
          assetType: instrument.assetType as InstrumentInput["assetType"],
          quoteCurrency: instrument.quoteCurrency,
        }
      : {
          externalId: "",
          name: "",
          symbol: "",
          identifierType: "custom",
          identifier: "",
          exchangeMic: "",
          assetType: "stock",
          quoteCurrency: "KES",
        },
  });
  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit(async (values) => {
        setError("");
        try {
          if (instrument)
            await updateInstrument(instrument.id, values, session.csrfToken);
          else await createInstrument(values, session.csrfToken);
          if (!instrument) reset();
          onChanged();
        } catch (caught) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The instrument could not be saved.",
          );
        }
      })}
    >
      <ErrorNotice message={error} />
      <div className="form-grid">
        <div>
          <label htmlFor={`instrument-name-${instrument?.id ?? "new"}`}>
            Name
          </label>
          <input
            id={`instrument-name-${instrument?.id ?? "new"}`}
            {...register("name")}
          />
        </div>
        <div>
          <label htmlFor={`instrument-symbol-${instrument?.id ?? "new"}`}>
            Symbol
          </label>
          <input
            id={`instrument-symbol-${instrument?.id ?? "new"}`}
            {...register("symbol")}
          />
        </div>
        <div>
          <label htmlFor={`instrument-id-type-${instrument?.id ?? "new"}`}>
            Identifier type
          </label>
          <select
            id={`instrument-id-type-${instrument?.id ?? "new"}`}
            {...register("identifierType")}
          >
            <option value="isin">ISIN</option>
            <option value="ticker_exchange">Ticker and exchange</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label htmlFor={`instrument-id-${instrument?.id ?? "new"}`}>
            Identifier
          </label>
          <input
            id={`instrument-id-${instrument?.id ?? "new"}`}
            {...register("identifier")}
          />
        </div>
        <div>
          <label htmlFor={`instrument-mic-${instrument?.id ?? "new"}`}>
            Exchange MIC
          </label>
          <input
            id={`instrument-mic-${instrument?.id ?? "new"}`}
            {...register("exchangeMic")}
          />
        </div>
        <div>
          <label htmlFor={`instrument-type-${instrument?.id ?? "new"}`}>
            Asset type
          </label>
          <select
            id={`instrument-type-${instrument?.id ?? "new"}`}
            {...register("assetType")}
          >
            <option value="stock">Stock</option>
            <option value="etf">ETF</option>
            <option value="fund">Fund</option>
          </select>
        </div>
        <div>
          <label htmlFor={`instrument-currency-${instrument?.id ?? "new"}`}>
            Quote currency
          </label>
          <input
            id={`instrument-currency-${instrument?.id ?? "new"}`}
            maxLength={3}
            {...register("quoteCurrency")}
          />
        </div>
        <div>
          <label htmlFor={`instrument-external-${instrument?.id ?? "new"}`}>
            External ID
          </label>
          <input
            id={`instrument-external-${instrument?.id ?? "new"}`}
            {...register("externalId")}
          />
        </div>
      </div>
      <button className="primary-button compact" disabled={isSubmitting}>
        <Save size={16} />
        {isSubmitting
          ? "Saving..."
          : instrument
            ? "Save instrument"
            : "Create instrument"}
      </button>
    </form>
  );
}

export function InstrumentManager({
  instrument,
  prices,
  session,
  onChanged,
}: {
  instrument: Instrument;
  prices: SecurityPrice[];
  session: Session;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const priceSchema = z.object({
    externalId: z.string(),
    price: z.string().min(1),
    effectiveDate: z.iso.date(),
    source: z.string(),
    provenance: z.string(),
  });
  const priceForm = useForm({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      externalId: "",
      price: "",
      effectiveDate: today(),
      source: "manual",
      provenance: "",
    },
  });
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The instrument could not be changed.",
      );
    }
  };
  return (
    <div className="settings-stack section-block">
      <ErrorNotice message={error} />
      <Card>
        <CardHeader title="Manage instrument" />
        <div className="page-actions">
          <button
            className="secondary-button"
            onClick={() => setEditing(!editing)}
          >
            <Save size={16} /> Edit
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              if (
                window.confirm(
                  `${instrument.archivedAt ? "Restore" : "Archive"} ${instrument.name}?`,
                )
              )
                void run(() =>
                  archiveInstrument(
                    instrument.id,
                    !instrument.archivedAt,
                    session.csrfToken,
                  ),
                );
            }}
          >
            <Archive size={16} />
            {instrument.archivedAt ? "Restore" : "Archive"}
          </button>
          <button
            className="secondary-button danger-button"
            onClick={() => {
              if (window.confirm(`Delete ${instrument.name}?`))
                void run(() =>
                  deleteInstrument(instrument.id, session.csrfToken).then(() =>
                    window.location.assign("/instruments"),
                  ),
                );
            }}
          >
            <Trash2 size={16} /> Delete
          </button>
        </div>
        {editing ? (
          <InstrumentForm
            instrument={instrument}
            session={session}
            onChanged={onChanged}
          />
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Record security price" />
        <form
          className="auth-form"
          onSubmit={priceForm.handleSubmit(async (values) => {
            await run(() =>
              upsertSecurityPrice(
                { instrumentId: instrument.id, ...values },
                session.csrfToken,
              ),
            );
            priceForm.reset();
          })}
        >
          <div className="form-grid">
            <div>
              <label htmlFor="price-value">
                Price ({instrument.quoteCurrency})
              </label>
              <input
                id="price-value"
                inputMode="decimal"
                {...priceForm.register("price")}
              />
            </div>
            <div>
              <label htmlFor="price-date">Effective date</label>
              <input
                id="price-date"
                type="date"
                {...priceForm.register("effectiveDate")}
              />
            </div>
            <div>
              <label htmlFor="price-source">Source</label>
              <input id="price-source" {...priceForm.register("source")} />
            </div>
            <div>
              <label htmlFor="price-provenance">Provenance</label>
              <input
                id="price-provenance"
                {...priceForm.register("provenance")}
              />
            </div>
            <div>
              <label htmlFor="price-external">External ID</label>
              <input
                id="price-external"
                {...priceForm.register("externalId")}
              />
            </div>
          </div>
          <button
            className="primary-button compact"
            disabled={priceForm.formState.isSubmitting}
          >
            <Plus size={16} /> Save price
          </button>
        </form>
        <div className="data-list">
          {prices.map((price) => (
            <div className="data-row" key={price.id}>
              <div>
                <strong>{price.effectiveDate}</strong>
                <span>{price.source}</span>
              </div>
              <div className="page-actions">
                <strong>
                  {price.currency} {price.price}
                </strong>
                <button
                  className="icon-button"
                  aria-label={`Delete price from ${price.effectiveDate}`}
                  onClick={() => {
                    if (window.confirm("Delete this security price?"))
                      void run(() =>
                        deleteSecurityPrice(price.id, session.csrfToken),
                      );
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
