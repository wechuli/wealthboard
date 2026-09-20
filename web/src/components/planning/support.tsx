import {
  Archive,
  ArrowDown,
  ArrowUp,
  CircleDollarSign,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  archiveCategory,
  archiveInstitution,
  createCategory,
  createGoal,
  createInstitution,
  createInstrument,
  reorderCategory,
  updateCategory,
  updateGoal,
  updateInstitution,
  updateInstrument,
} from "@/api/client";
import { minorUnitsToDecimal } from "@/lib/format";
import {
  Checkbox,
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/original";
import { Badge, Button, Card } from "@/components/ui/core";
import type {
  Account,
  Category,
  CategoryInput,
  Goal,
  GoalInput,
  Institution,
  InstitutionInput,
  Instrument,
  InstrumentInput,
  Session,
} from "@/lib/types";

function value(data: FormData, name: string) {
  return String(data.get(name) ?? "");
}

function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200"
    >
      {message}
    </p>
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const currency = goal?.currency ?? "KES";
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: GoalInput = {
      idempotencyKey: goal ? undefined : idempotencyKey,
      name: value(data, "name"),
      description: value(data, "description") || null,
      targetAmount: value(data, "targetAmount"),
      currentAmount: value(data, "currentAmount") || "0",
      currency: value(data, "currency"),
      targetDate: value(data, "targetDate"),
      linkedAccountId: value(data, "linkedAccountId") || null,
      icon: "Target",
      status: value(data, "status"),
      priority: 0,
      assumedAnnualReturn: Number(value(data, "assumedAnnualReturn")),
      plannedContribution: value(data, "plannedContribution") || "0",
      frequency: value(data, "frequency"),
      planStartDate: value(data, "planStartDate"),
      planEndDate: value(data, "planEndDate"),
    };
    setPending(true);
    setError("");
    try {
      if (goal) await updateGoal(goal.id, input, session.csrfToken);
      else await createGoal(input, session.csrfToken);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The goal could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="name">Goal name</Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g. 2028 Family Car"
            defaultValue={goal?.name}
            required
          />
        </div>
        <div>
          <Label htmlFor="targetAmount">Target amount ({currency})</Label>
          <Input
            id="targetAmount"
            name="targetAmount"
            inputMode="decimal"
            defaultValue={
              goal ? minorUnitsToDecimal(goal.targetAmountMinor) : ""
            }
            required
          />
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            name="currency"
            maxLength={3}
            defaultValue={currency}
            required
          />
        </div>
        <div>
          <Label htmlFor="targetDate">Target date</Label>
          <Input
            id="targetDate"
            name="targetDate"
            type="date"
            defaultValue={goal?.targetDate.slice(0, 10)}
            required
          />
        </div>
        <div>
          <Label htmlFor="linkedAccountId">Linked account</Label>
          <Select
            id="linkedAccountId"
            name="linkedAccountId"
            defaultValue={goal?.linkedAccount?.id ?? ""}
          >
            <option value="">No linked account</option>
            {accounts
              .filter((account) => !account.isLiability && !account.archivedAt)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="currentAmount">Current amount ({currency})</Label>
          <Input
            id="currentAmount"
            name="currentAmount"
            inputMode="decimal"
            placeholder="Used only without linked account"
            defaultValue={
              goal ? minorUnitsToDecimal(goal.currentAmountMinor) : "0.00"
            }
          />
        </div>
        <div>
          <Label htmlFor="plannedContribution">
            Planned contribution ({currency})
          </Label>
          <Input
            id="plannedContribution"
            name="plannedContribution"
            inputMode="decimal"
            defaultValue={
              goal
                ? minorUnitsToDecimal(
                    goal.plan?.plannedContributionMinor ?? "0",
                  )
                : "0.00"
            }
          />
        </div>
        <div>
          <Label htmlFor="frequency">Contribution frequency</Label>
          <Select
            id="frequency"
            name="frequency"
            defaultValue={goal?.plan?.frequency ?? "monthly"}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
            <option value="custom">Custom monthly equivalent</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="planStartDate">Plan start</Label>
          <Input
            id="planStartDate"
            name="planStartDate"
            type="date"
            defaultValue={goal?.plan?.startDate ?? today}
          />
        </div>
        <div>
          <Label htmlFor="planEndDate">Plan end</Label>
          <Input
            id="planEndDate"
            name="planEndDate"
            type="date"
            defaultValue={goal?.plan?.endDate ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="assumedAnnualReturn">Assumed annual return (%)</Label>
          <Input
            id="assumedAnnualReturn"
            name="assumedAnnualReturn"
            type="number"
            min="0"
            max="100"
            step="0.1"
            defaultValue={(goal?.assumedAnnualReturnBps ?? 800) / 100}
          />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select
            id="status"
            name="status"
            defaultValue={goal?.status ?? "active"}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={goal?.description ?? ""}
          />
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="flex justify-end">
        <Button disabled={pending}>
          {pending ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              size={17}
            />
          ) : (
            <Save size={17} />
          )}
          {goal ? "Save goal" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}

export function InstrumentForm({
  session,
  onChanged,
  instrument,
}: {
  session: Session;
  onChanged: () => void;
  instrument?: Instrument;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: InstrumentInput = {
      externalId: value(data, "externalId"),
      name: value(data, "name"),
      symbol: value(data, "symbol"),
      identifierType: value(
        data,
        "identifierType",
      ) as InstrumentInput["identifierType"],
      identifier: value(data, "identifier"),
      exchangeMic: value(data, "exchangeMic"),
      assetType: value(data, "assetType") as InstrumentInput["assetType"],
      quoteCurrency: value(data, "quoteCurrency"),
    };
    setPending(true);
    setError("");
    try {
      if (instrument)
        await updateInstrument(instrument.id, input, session.csrfToken);
      else await createInstrument(input, session.csrfToken);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The instrument could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  const suffix = instrument?.id ?? "new";
  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor={`instrument-name-${suffix}`}>Name</Label>
          <Input
            id={`instrument-name-${suffix}`}
            name="name"
            defaultValue={instrument?.name}
            required
          />
        </div>
        <div>
          <Label htmlFor={`instrument-symbol-${suffix}`}>Symbol</Label>
          <Input
            id={`instrument-symbol-${suffix}`}
            name="symbol"
            defaultValue={instrument?.symbol ?? ""}
          />
        </div>
        <div>
          <Label htmlFor={`instrument-id-type-${suffix}`}>
            Identifier type
          </Label>
          <Select
            id={`instrument-id-type-${suffix}`}
            name="identifierType"
            defaultValue={instrument?.identifierType ?? "custom"}
          >
            <option value="isin">ISIN</option>
            <option value="ticker_exchange">Ticker and exchange</option>
            <option value="custom">Custom</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`instrument-id-${suffix}`}>Identifier</Label>
          <Input
            id={`instrument-id-${suffix}`}
            name="identifier"
            defaultValue={instrument?.identifier ?? ""}
          />
        </div>
        <div>
          <Label htmlFor={`instrument-mic-${suffix}`}>Exchange MIC</Label>
          <Input
            id={`instrument-mic-${suffix}`}
            name="exchangeMic"
            defaultValue={instrument?.exchangeMic ?? ""}
          />
        </div>
        <div>
          <Label htmlFor={`instrument-type-${suffix}`}>Asset type</Label>
          <Select
            id={`instrument-type-${suffix}`}
            name="assetType"
            defaultValue={instrument?.assetType ?? "stock"}
          >
            <option value="stock">Stock</option>
            <option value="etf">ETF</option>
            <option value="fund">Fund</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`instrument-currency-${suffix}`}>
            Quote currency
          </Label>
          <Input
            id={`instrument-currency-${suffix}`}
            name="quoteCurrency"
            maxLength={3}
            defaultValue={instrument?.quoteCurrency ?? "KES"}
            required
          />
        </div>
        <div>
          <Label htmlFor={`instrument-external-${suffix}`}>External ID</Label>
          <Input
            id={`instrument-external-${suffix}`}
            name="externalId"
            defaultValue={instrument?.externalId ?? ""}
          />
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="flex justify-end">
        <Button disabled={pending}>
          {pending ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              size={17}
            />
          ) : (
            <Save size={17} />
          )}
          {instrument ? "Save instrument" : "Create instrument"}
        </Button>
      </div>
    </form>
  );
}

function CategoryEditor({
  category,
  csrfToken,
  onChanged,
}: {
  category?: Category;
  csrfToken: string;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: CategoryInput = {
      name: value(data, "name"),
      icon: value(data, "icon"),
      assetOrLiability: value(
        data,
        "assetOrLiability",
      ) as CategoryInput["assetOrLiability"],
      description: category?.description ?? "",
      isLiquid: data.has("isLiquid"),
      isInvestible: data.has("isInvestible"),
    };
    setPending(true);
    try {
      if (category) await updateCategory(category.id, input, csrfToken);
      else await createCategory(input, csrfToken);
      onChanged();
    } finally {
      setPending(false);
    }
  }
  const suffix = category?.id ?? "new";
  return (
    <form
      className="grid items-end gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto_auto_auto]"
      onSubmit={submit}
    >
      <div>
        <Label htmlFor={`name-${suffix}`}>Name</Label>
        <Input
          id={`name-${suffix}`}
          name="name"
          defaultValue={category?.name}
          required
        />
      </div>
      <div>
        <Label htmlFor={`icon-${suffix}`}>Icon</Label>
        <Select
          id={`icon-${suffix}`}
          name="icon"
          defaultValue={category?.icon ?? "CircleDollarSign"}
        >
          <option>CircleDollarSign</option>
          <option>Landmark</option>
          <option>Home</option>
          <option>WalletCards</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`kind-${suffix}`}>Classification</Label>
        <Select
          id={`kind-${suffix}`}
          name="assetOrLiability"
          defaultValue={category?.assetOrLiability ?? "asset"}
        >
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
        </Select>
      </div>
      <Checkbox
        name="isLiquid"
        label="Liquid"
        defaultChecked={category?.isLiquid}
      />
      <Checkbox
        name="isInvestible"
        label="Investible"
        defaultChecked={category?.isInvestible ?? true}
      />
      <Button size="sm" disabled={pending}>
        {pending ? (
          <LoaderCircle className="animate-spin" size={15} />
        ) : category ? (
          <Save size={15} />
        ) : (
          <Plus size={15} />
        )}
        {category ? "Save" : "Add"}
      </Button>
    </form>
  );
}

export function CategoryManager({
  categories,
  csrfToken,
  onChanged,
}: {
  categories: Category[];
  csrfToken: string;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Create custom category</h2>
        <CategoryEditor csrfToken={csrfToken} onChanged={onChanged} />
      </Card>
      <div className="space-y-3">
        {categories.map((category, index) => (
          <Card key={category.id} className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-white/[0.05] p-2 text-slate-300">
                  <CircleDollarSign size={18} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{category.name}</h2>
                    {category.isSystem ? <Badge>Built in</Badge> : null}
                    {category.isArchived ? (
                      <Badge tone="warning">Archived</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500">
                    {category.assetOrLiability === "asset"
                      ? "Asset"
                      : "Liability"}{" "}
                    · order {index + 1}
                  </p>
                </div>
              </div>
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move category up"
                  disabled={index === 0}
                  onClick={() =>
                    void reorderCategory(category.id, "up", csrfToken).then(
                      onChanged,
                    )
                  }
                >
                  <ArrowUp size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move category down"
                  disabled={index === categories.length - 1}
                  onClick={() =>
                    void reorderCategory(category.id, "down", csrfToken).then(
                      onChanged,
                    )
                  }
                >
                  <ArrowDown size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    category.isArchived
                      ? "Restore category"
                      : "Archive category"
                  }
                  onClick={() => {
                    if (
                      category.isArchived ||
                      window.confirm(
                        "Archive this category? Existing accounts will retain it.",
                      )
                    )
                      void archiveCategory(
                        category.id,
                        !category.isArchived,
                        csrfToken,
                      ).then(onChanged);
                  }}
                >
                  {category.isArchived ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </Button>
              </div>
            </div>
            <CategoryEditor
              category={category}
              csrfToken={csrfToken}
              onChanged={onChanged}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

const institutionTypes = [
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
];

function InstitutionEditor({
  institution,
  csrfToken,
  onChanged,
}: {
  institution?: Institution;
  csrfToken: string;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: InstitutionInput = {
      name: value(data, "name"),
      type: value(data, "type") as InstitutionInput["type"],
      websiteUrl: value(data, "websiteUrl"),
      countryCode: value(data, "countryCode"),
      address: value(data, "address"),
      notes: value(data, "notes"),
    };
    setPending(true);
    setError("");
    try {
      if (institution)
        await updateInstitution(institution.id, input, csrfToken);
      else await createInstitution(input, csrfToken);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The institution could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  const suffix = institution?.id ?? "new";
  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={submit}>
      <div>
        <Label htmlFor={`institution-name-${suffix}`}>Name</Label>
        <Input
          id={`institution-name-${suffix}`}
          name="name"
          defaultValue={institution?.name}
          required
          maxLength={100}
        />
      </div>
      <div>
        <Label htmlFor={`institution-type-${suffix}`}>Type</Label>
        <Select
          id={`institution-type-${suffix}`}
          name="type"
          defaultValue={institution?.type ?? "bank"}
        >
          {institutionTypes.map((type) => (
            <option key={type} value={type}>
              {type
                .replaceAll("_", " ")
                .replace(/^./, (letter) => letter.toUpperCase())}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`institution-website-${suffix}`}>Website</Label>
        <Input
          id={`institution-website-${suffix}`}
          name="websiteUrl"
          type="url"
          defaultValue={institution?.websiteUrl ?? ""}
          placeholder="https://example.com"
          maxLength={500}
        />
      </div>
      <div>
        <Label htmlFor={`institution-country-${suffix}`}>Country code</Label>
        <Input
          id={`institution-country-${suffix}`}
          name="countryCode"
          defaultValue={institution?.countryCode ?? ""}
          placeholder="e.g. KE"
          maxLength={2}
        />
      </div>
      <div className="lg:col-span-2">
        <Label htmlFor={`institution-address-${suffix}`}>Address</Label>
        <Textarea
          id={`institution-address-${suffix}`}
          name="address"
          defaultValue={institution?.address ?? ""}
          maxLength={500}
          className="min-h-20"
        />
      </div>
      <div className="lg:col-span-2">
        <Label htmlFor={`institution-notes-${suffix}`}>Notes</Label>
        <Textarea
          id={`institution-notes-${suffix}`}
          name="notes"
          defaultValue={institution?.notes ?? ""}
          maxLength={2000}
          className="min-h-20"
        />
      </div>
      {error ? (
        <div className="lg:col-span-2">
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
      <div className="flex justify-end lg:col-span-2">
        <Button size="sm" disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" size={15} />
          ) : institution ? (
            <Save size={15} />
          ) : (
            <Plus size={15} />
          )}
          {institution ? "Save institution" : "Add institution"}
        </Button>
      </div>
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
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-4 text-sm font-semibold">Add institution</h2>
        <InstitutionEditor csrfToken={csrfToken} onChanged={onChanged} />
      </Card>
      {institutions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-5 py-12 text-center">
          <p className="mt-3 text-sm text-slate-400">
            No institutions have been added yet.
          </p>
        </div>
      ) : (
        institutions.map((institution) => (
          <Card key={institution.id} className="p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium text-slate-100">
                    {institution.name}
                  </h2>
                  {institution.archivedAt ? (
                    <Badge tone="warning">Archived</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Changes apply to every linked account and report.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  institution.archivedAt
                    ? "Restore institution"
                    : "Archive institution"
                }
                onClick={() => {
                  if (
                    institution.archivedAt ||
                    window.confirm(
                      "Archive this institution? Existing account links will remain.",
                    )
                  )
                    void archiveInstitution(
                      institution.id,
                      !institution.archivedAt,
                      csrfToken,
                    ).then(onChanged);
                }}
              >
                {institution.archivedAt ? (
                  <RotateCcw size={16} />
                ) : (
                  <Archive size={16} />
                )}
              </Button>
            </div>
            <InstitutionEditor
              institution={institution}
              csrfToken={csrfToken}
              onChanged={onChanged}
            />
          </Card>
        ))
      )}
    </div>
  );
}
