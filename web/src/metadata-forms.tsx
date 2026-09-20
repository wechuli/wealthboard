import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import {
  archiveCategory,
  archiveInstitution,
  createCategory,
  createExchangeRate,
  createInstitution,
  deleteExchangeRate,
  reorderCategory,
  updateCategory,
  updateInstitution,
  updateSettings,
} from "./api";
import type {
  Category,
  CategoryInput,
  Institution,
  InstitutionInput,
  SettingsInput,
  SettingsRead,
} from "./types";
import { Badge, Card, CardHeader } from "./ui";

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(100),
  icon: z.string().trim().min(1).max(100),
  assetOrLiability: z.enum(["asset", "liability"]),
  description: z.string().trim().max(2000),
  isLiquid: z.boolean(),
  isInvestible: z.boolean(),
});

const institutionSchema = z.object({
  name: z.string().trim().min(1, "Enter an institution name.").max(100),
  type: z.enum([
    "bank",
    "credit_union",
    "brokerage",
    "asset_manager",
    "pension_provider",
    "insurer",
    "lender",
    "digital_wallet",
    "government",
    "employer",
    "other",
  ]),
  websiteUrl: z.union([z.literal(""), z.url()]),
  countryCode: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
  ]),
  address: z.string().trim().max(500),
  notes: z.string().trim().max(2000),
});

type CategoryOperations = {
  create: typeof createCategory;
  update: typeof updateCategory;
  archive: typeof archiveCategory;
  reorder: typeof reorderCategory;
};

const categoryOperations: CategoryOperations = {
  create: createCategory,
  update: updateCategory,
  archive: archiveCategory,
  reorder: reorderCategory,
};

export function CategoryManager({
  categories,
  csrfToken,
  onChanged,
  operations = categoryOperations,
}: {
  categories: Category[];
  csrfToken: string;
  onChanged: () => void;
  operations?: CategoryOperations;
}) {
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      setEditing(undefined);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The category could not be changed.",
      );
    }
  }

  return (
    <div className="settings-stack">
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <Card>
        <CardHeader title="Create custom category" />
        <CategoryForm
          onSubmit={(input) => run(() => operations.create(input, csrfToken))}
        />
      </Card>
      {categories.map((category, index) => (
        <Card key={category.id}>
          <CardHeader
            title={category.name}
            description={`${category.assetOrLiability === "asset" ? "Asset" : "Liability"} · order ${index + 1}`}
            aside={
              category.isArchived ? (
                <Badge tone="warning">Archived</Badge>
              ) : category.isSystem ? (
                <Badge>Built in</Badge>
              ) : undefined
            }
          />
          <div className="page-actions">
            <button
              className="icon-button"
              aria-label={`Move ${category.name} up`}
              disabled={index === 0}
              onClick={() =>
                void run(() => operations.reorder(category.id, "up", csrfToken))
              }
            >
              <ArrowUp />
            </button>
            <button
              className="icon-button"
              aria-label={`Move ${category.name} down`}
              disabled={index === categories.length - 1}
              onClick={() =>
                void run(() =>
                  operations.reorder(category.id, "down", csrfToken),
                )
              }
            >
              <ArrowDown />
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                setEditing(editing === category.id ? undefined : category.id)
              }
            >
              <Save size={16} /> Edit
            </button>
            <button
              className="icon-button"
              aria-label={`${category.isArchived ? "Restore" : "Archive"} ${category.name}`}
              onClick={() => {
                if (
                  !category.isArchived &&
                  !window.confirm(
                    `Archive ${category.name}? Existing accounts will retain it.`,
                  )
                )
                  return;
                void run(() =>
                  operations.archive(
                    category.id,
                    !category.isArchived,
                    csrfToken,
                  ),
                );
              }}
            >
              {category.isArchived ? <RotateCcw /> : <Archive />}
            </button>
          </div>
          {editing === category.id ? (
            <CategoryForm
              initial={category}
              onSubmit={(input) =>
                run(() => operations.update(category.id, input, csrfToken))
              }
            />
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function CategoryForm({
  initial,
  onSubmit,
}: {
  initial?: Category;
  onSubmit: (input: CategoryInput) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema) as Resolver<CategoryInput>,
    defaultValues: initial
      ? {
          name: initial.name,
          icon: initial.icon,
          assetOrLiability:
            initial.assetOrLiability as CategoryInput["assetOrLiability"],
          description: initial.description ?? "",
          isLiquid: initial.isLiquid,
          isInvestible: initial.isInvestible,
        }
      : {
          icon: "CircleDollarSign",
          assetOrLiability: "asset",
          description: "",
          isLiquid: false,
          isInvestible: true,
        },
  });
  return (
    <form
      className="auth-form"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(values);
        if (!initial) reset();
      })}
    >
      <div className="form-grid">
        <div>
          <label htmlFor={`category-name-${initial?.id ?? "new"}`}>Name</label>
          <input
            id={`category-name-${initial?.id ?? "new"}`}
            {...register("name")}
          />
          {errors.name ? (
            <p className="form-error">{errors.name.message}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`category-icon-${initial?.id ?? "new"}`}>Icon</label>
          <input
            id={`category-icon-${initial?.id ?? "new"}`}
            {...register("icon")}
          />
        </div>
        <div>
          <label htmlFor={`category-kind-${initial?.id ?? "new"}`}>
            Classification
          </label>
          <select
            id={`category-kind-${initial?.id ?? "new"}`}
            {...register("assetOrLiability")}
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
          </select>
        </div>
        <div>
          <label htmlFor={`category-description-${initial?.id ?? "new"}`}>
            Description
          </label>
          <input
            id={`category-description-${initial?.id ?? "new"}`}
            {...register("description")}
          />
        </div>
      </div>
      <div className="scope-grid">
        <label>
          <input type="checkbox" {...register("isLiquid")} /> Liquid
        </label>
        <label>
          <input type="checkbox" {...register("isInvestible")} /> Investible
        </label>
      </div>
      <button
        className="primary-button compact"
        disabled={isSubmitting}
        type="submit"
      >
        {initial ? <Save size={16} /> : <Plus size={16} />}
        {isSubmitting
          ? "Saving..."
          : initial
            ? "Save category"
            : "Add category"}
      </button>
    </form>
  );
}

export function InstitutionManager({
  institutions,
  csrfToken,
  onChanged,
}: {
  institutions: Institution[];
  csrfToken: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      setEditing(undefined);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The institution could not be changed.",
      );
    }
  }
  return (
    <div className="settings-stack">
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <Card>
        <CardHeader title="Add institution" />
        <InstitutionForm
          onSubmit={(input) => run(() => createInstitution(input, csrfToken))}
        />
      </Card>
      {institutions.map((institution) => (
        <Card key={institution.id}>
          <CardHeader
            title={institution.name}
            description={[institution.type, institution.countryCode]
              .filter(Boolean)
              .join(" · ")}
            aside={
              institution.archivedAt ? (
                <Badge tone="warning">Archived</Badge>
              ) : undefined
            }
          />
          <div className="page-actions">
            <button
              className="secondary-button"
              onClick={() =>
                setEditing(
                  editing === institution.id ? undefined : institution.id,
                )
              }
            >
              <Save size={16} /> Edit
            </button>
            <button
              className="icon-button"
              aria-label={`${institution.archivedAt ? "Restore" : "Archive"} ${institution.name}`}
              onClick={() => {
                if (
                  !institution.archivedAt &&
                  !window.confirm(`Archive ${institution.name}?`)
                )
                  return;
                void run(() =>
                  archiveInstitution(
                    institution.id,
                    !institution.archivedAt,
                    csrfToken,
                  ),
                );
              }}
            >
              {institution.archivedAt ? <RotateCcw /> : <Archive />}
            </button>
          </div>
          {editing === institution.id ? (
            <InstitutionForm
              initial={institution}
              onSubmit={(input) =>
                run(() => updateInstitution(institution.id, input, csrfToken))
              }
            />
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function InstitutionForm({
  initial,
  onSubmit,
}: {
  initial?: Institution;
  onSubmit: (input: InstitutionInput) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InstitutionInput>({
    resolver: zodResolver(institutionSchema) as Resolver<InstitutionInput>,
    defaultValues: initial
      ? {
          name: initial.name,
          type: initial.type as InstitutionInput["type"],
          websiteUrl: initial.websiteUrl ?? "",
          countryCode: initial.countryCode ?? "",
          address: initial.address ?? "",
          notes: initial.notes ?? "",
        }
      : {
          name: "",
          type: "bank",
          websiteUrl: "",
          countryCode: "",
          address: "",
          notes: "",
        },
  });
  return (
    <form
      className="auth-form"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(values);
        if (!initial) reset();
      })}
    >
      <div className="form-grid">
        <div>
          <label htmlFor={`institution-name-${initial?.id ?? "new"}`}>
            Name
          </label>
          <input
            id={`institution-name-${initial?.id ?? "new"}`}
            {...register("name")}
          />
          {errors.name ? (
            <p className="form-error">{errors.name.message}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`institution-type-${initial?.id ?? "new"}`}>
            Type
          </label>
          <select
            id={`institution-type-${initial?.id ?? "new"}`}
            {...register("type")}
          >
            <option value="bank">Bank</option>
            <option value="credit_union">Credit union</option>
            <option value="brokerage">Brokerage</option>
            <option value="asset_manager">Asset manager</option>
            <option value="pension_provider">Pension provider</option>
            <option value="insurer">Insurer</option>
            <option value="lender">Lender</option>
            <option value="digital_wallet">Digital wallet</option>
            <option value="government">Government</option>
            <option value="employer">Employer</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor={`institution-country-${initial?.id ?? "new"}`}>
            Country code
          </label>
          <input
            id={`institution-country-${initial?.id ?? "new"}`}
            maxLength={2}
            {...register("countryCode")}
          />
        </div>
        <div>
          <label htmlFor={`institution-url-${initial?.id ?? "new"}`}>
            Website
          </label>
          <input
            id={`institution-url-${initial?.id ?? "new"}`}
            type="url"
            {...register("websiteUrl")}
          />
          {errors.websiteUrl ? (
            <p className="form-error">{errors.websiteUrl.message}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`institution-address-${initial?.id ?? "new"}`}>
            Address
          </label>
          <input
            id={`institution-address-${initial?.id ?? "new"}`}
            {...register("address")}
          />
        </div>
        <div>
          <label htmlFor={`institution-notes-${initial?.id ?? "new"}`}>
            Notes
          </label>
          <input
            id={`institution-notes-${initial?.id ?? "new"}`}
            {...register("notes")}
          />
        </div>
      </div>
      <button
        className="primary-button compact"
        disabled={isSubmitting}
        type="submit"
      >
        <Save size={16} />
        {isSubmitting
          ? "Saving..."
          : initial
            ? "Save institution"
            : "Add institution"}
      </button>
    </form>
  );
}

const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  appName: z.string().trim().min(1).max(80),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  supportedCurrenciesText: z.string(),
  timezone: z.string().trim().min(1),
  preferredDateFormat: z.enum([
    "dd MMM yyyy",
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "yyyy-MM-dd",
  ]),
  defaultDashboardPeriod: z.enum(["1m", "3m", "6m", "1y", "all"]),
  sessionTimeoutMinutes: z.number().int().min(15).max(525600),
  defaultGoalReturnBps: z.number().int().min(0).max(10000),
  positionStaleDaysStock: z.number().int().min(1),
  positionStaleDaysEtf: z.number().int().min(1),
  positionStaleDaysFund: z.number().int().min(1),
});

export function SettingsEditor({
  data,
  csrfToken,
  onChanged,
}: {
  data: SettingsRead;
  csrfToken: string;
  onChanged: () => void;
}) {
  const [message, setMessage] = useState("");
  const settings = data.settings;
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      displayName: settings.displayName,
      appName: settings.appName,
      baseCurrency: settings.baseCurrency,
      supportedCurrenciesText:
        data.currencyConfiguration.enabledCurrencies.join(", "),
      timezone: settings.timezone,
      preferredDateFormat: settings.preferredDateFormat as z.infer<
        typeof settingsSchema
      >["preferredDateFormat"],
      defaultDashboardPeriod: settings.defaultDashboardPeriod as z.infer<
        typeof settingsSchema
      >["defaultDashboardPeriod"],
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
      defaultGoalReturnBps: settings.defaultGoalReturnBps,
      positionStaleDaysStock: settings.positionStaleDaysStock,
      positionStaleDaysEtf: settings.positionStaleDaysEtf,
      positionStaleDaysFund: settings.positionStaleDaysFund,
    },
  });
  return (
    <Card>
      <CardHeader
        title="Edit general settings"
        description="Changes apply to this application user."
      />
      {message ? (
        <div className="notice error" role="alert">
          {message}
        </div>
      ) : null}
      <form
        className="auth-form"
        onSubmit={handleSubmit(
          async ({ supportedCurrenciesText, ...values }) => {
            setMessage("");
            const input: SettingsInput = {
              ...values,
              supportedCurrencies: supportedCurrenciesText
                .split(",")
                .map((value) => value.trim().toUpperCase())
                .filter(Boolean),
            };
            try {
              await updateSettings(input, csrfToken);
              onChanged();
            } catch (caught) {
              setMessage(
                caught instanceof Error
                  ? caught.message
                  : "Settings could not be saved.",
              );
            }
          },
        )}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="settings-display-name">Display name</label>
            <input id="settings-display-name" {...register("displayName")} />
          </div>
          <div>
            <label htmlFor="settings-app-name">Application name</label>
            <input id="settings-app-name" {...register("appName")} />
          </div>
          <div>
            <label htmlFor="settings-base-currency">Base currency</label>
            <input
              id="settings-base-currency"
              maxLength={3}
              {...register("baseCurrency")}
            />
          </div>
          <div>
            <label htmlFor="settings-currencies">Enabled currencies</label>
            <input
              id="settings-currencies"
              {...register("supportedCurrenciesText")}
            />
          </div>
          <div>
            <label htmlFor="settings-timezone">Timezone</label>
            <input id="settings-timezone" {...register("timezone")} />
          </div>
          <div>
            <label htmlFor="settings-date-format">Date format</label>
            <select
              id="settings-date-format"
              {...register("preferredDateFormat")}
            >
              <option>dd MMM yyyy</option>
              <option>dd/MM/yyyy</option>
              <option>MM/dd/yyyy</option>
              <option>yyyy-MM-dd</option>
            </select>
          </div>
          <div>
            <label htmlFor="settings-period">Dashboard period</label>
            <select
              id="settings-period"
              {...register("defaultDashboardPeriod")}
            >
              <option value="1m">1 month</option>
              <option value="3m">3 months</option>
              <option value="6m">6 months</option>
              <option value="1y">1 year</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="settings-timeout">Session timeout (minutes)</label>
            <input
              id="settings-timeout"
              type="number"
              {...register("sessionTimeoutMinutes", { valueAsNumber: true })}
            />
          </div>
          <div>
            <label htmlFor="settings-return">Default goal return (bps)</label>
            <input
              id="settings-return"
              type="number"
              {...register("defaultGoalReturnBps", { valueAsNumber: true })}
            />
          </div>
          <div>
            <label htmlFor="settings-stock-stale">Stock stale days</label>
            <input
              id="settings-stock-stale"
              type="number"
              {...register("positionStaleDaysStock", { valueAsNumber: true })}
            />
          </div>
          <div>
            <label htmlFor="settings-etf-stale">ETF stale days</label>
            <input
              id="settings-etf-stale"
              type="number"
              {...register("positionStaleDaysEtf", { valueAsNumber: true })}
            />
          </div>
          <div>
            <label htmlFor="settings-fund-stale">Fund stale days</label>
            <input
              id="settings-fund-stale"
              type="number"
              {...register("positionStaleDaysFund", { valueAsNumber: true })}
            />
          </div>
        </div>
        <button className="primary-button compact" disabled={isSubmitting}>
          <Save size={16} />
          {isSubmitting ? "Saving..." : "Save settings"}
        </button>
      </form>
    </Card>
  );
}

const rateSchema = z.object({
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
    .regex(/^(?:0*[1-9]\d*)(?:\.\d+)?$|^0*\.\d*[1-9]\d*$/),
  effectiveDate: z.iso.date(),
});

export function ExchangeRateManager({
  data,
  csrfToken,
  onChanged,
}: {
  data: SettingsRead;
  csrfToken: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<z.infer<typeof rateSchema>>({
    resolver: zodResolver(rateSchema),
    defaultValues: {
      baseCurrency: data.settings.baseCurrency,
      quoteCurrency: "USD",
      rate: "",
      effectiveDate: new Date().toISOString().slice(0, 10),
    },
  });
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      onChanged();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The exchange rate could not be changed.",
      );
      return false;
    }
  };
  return (
    <Card>
      <CardHeader
        title="Manage exchange rates"
        description="Effective-dated decimal rates"
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        className="auth-form"
        onSubmit={handleSubmit(async (values) => {
          if (await run(() => createExchangeRate(values, csrfToken)))
            reset({ ...values, rate: "" });
        })}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="rate-base">Base currency</label>
            <input id="rate-base" maxLength={3} {...register("baseCurrency")} />
          </div>
          <div>
            <label htmlFor="rate-quote">Quote currency</label>
            <input
              id="rate-quote"
              maxLength={3}
              {...register("quoteCurrency")}
            />
          </div>
          <div>
            <label htmlFor="rate-value">Rate</label>
            <input id="rate-value" inputMode="decimal" {...register("rate")} />
          </div>
          <div>
            <label htmlFor="rate-date">Effective date</label>
            <input id="rate-date" type="date" {...register("effectiveDate")} />
          </div>
        </div>
        <button className="primary-button compact" disabled={isSubmitting}>
          <Plus size={16} />
          {isSubmitting ? "Saving..." : "Add exchange rate"}
        </button>
      </form>
      <div className="data-list">
        {data.exchangeRates.map((rate) => (
          <div className="data-row" key={rate.id}>
            <div>
              <strong>
                {rate.baseCurrency} / {rate.quoteCurrency}
              </strong>
              <span>
                {rate.effectiveDate} · {rate.source}
              </span>
            </div>
            <div className="page-actions">
              <strong>{rate.rate}</strong>
              <button
                className="icon-button"
                aria-label={`Delete ${rate.baseCurrency} to ${rate.quoteCurrency} rate`}
                onClick={() => {
                  if (window.confirm("Delete this exchange rate?"))
                    void run(() => deleteExchangeRate(rate.id, csrfToken));
                }}
              >
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
