"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Grid2X2,
  List,
  Search,
} from "lucide-react";

import { CategoryIcon } from "@/components/category-icon";
import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form-controls";
import { formatDate } from "@/lib/dates";

export type AccountListItem = {
  id: string;
  name: string;
  institutionId: string | null;
  institution: string | null;
  institutionArchivedAt: string | null;
  categoryName: string;
  categoryIcon: string;
  currency: string;
  currentValueMinor: number;
  convertedValueMinor: number | null;
  monthlyChangeMinor: number | null;
  isLiability: boolean;
  archivedAt: string | null;
  updatedAt: string;
  goalName: string | null;
  trackingMode: "balance" | "positions";
  positionCount: number;
  positionValueAsOf: string | null;
  priceState: "not_applicable" | "complete" | "missing" | "stale";
};

export function AccountsList({
  accounts,
  baseCurrency,
  timezone,
  dateFormat,
}: {
  accounts: AccountListItem[];
  baseCurrency: string;
  timezone: string;
  dateFormat: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [institution, setInstitution] = useState("all");
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("all");
  const [tracking, setTracking] = useState("all");
  const [priceState, setPriceState] = useState("all");
  const [sort, setSort] = useState("value");
  const [view, setView] = useState<"cards" | "table">("cards");
  const categories = [
    ...new Set(accounts.map((account) => account.categoryName)),
  ];
  const currencies = [...new Set(accounts.map((account) => account.currency))];
  const institutions = [
    ...new Map(
      accounts
        .filter((account) => account.institutionId && account.institution)
        .map((account) => [
          account.institutionId!,
          {
            id: account.institutionId!,
            name: account.institution!,
            archivedAt: account.institutionArchivedAt,
          },
        ]),
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));

  const visible = useMemo(() => {
    const normalized = query.toLowerCase();
    return accounts
      .filter(
        (account) =>
          (!normalized ||
            account.name.toLowerCase().includes(normalized) ||
            account.institution?.toLowerCase().includes(normalized)) &&
          (category === "all" || account.categoryName === category) &&
          (currency === "all" || account.currency === currency) &&
          (institution === "all" ||
            (institution === "unspecified"
              ? !account.institutionId
              : account.institutionId === institution)) &&
          (status === "all" ||
            (status === "archived"
              ? account.archivedAt
              : !account.archivedAt)) &&
          (kind === "all" ||
            (kind === "liability"
              ? account.isLiability
              : !account.isLiability)) &&
          (tracking === "all" || account.trackingMode === tracking) &&
          (priceState === "all" || account.priceState === priceState),
      )
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "category")
          return a.categoryName.localeCompare(b.categoryName);
        if (sort === "change")
          return (b.monthlyChangeMinor ?? 0) - (a.monthlyChangeMinor ?? 0);
        if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
        return (b.convertedValueMinor ?? 0) - (a.convertedValueMinor ?? 0);
      });
  }, [
    accounts,
    category,
    currency,
    institution,
    kind,
    priceState,
    query,
    sort,
    status,
    tracking,
  ]);

  return (
    <>
      <div className="mb-5 grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div className="relative">
          <Search
            className="absolute left-3 top-3.5 text-slate-500"
            size={16}
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accounts"
            className="pl-9"
            aria-label="Search accounts"
          />
        </div>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select
          value={tracking}
          onChange={(event) => setTracking(event.target.value)}
          aria-label="Filter by tracking method"
        >
          <option value="all">All tracking methods</option>
          <option value="balance">Account value</option>
          <option value="positions">Units and prices</option>
        </Select>
        <Select
          value={priceState}
          onChange={(event) => setPriceState(event.target.value)}
          aria-label="Filter by price state"
        >
          <option value="all">All price states</option>
          <option value="complete">Complete prices</option>
          <option value="missing">Missing prices</option>
          <option value="stale">Stale prices</option>
        </Select>
        <Select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          aria-label="Filter by currency"
        >
          <option value="all">All currencies</option>
          {currencies.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Select
          value={institution}
          onChange={(event) => setInstitution(event.target.value)}
          aria-label="Filter by institution"
        >
          <option value="all">All institutions</option>
          <option value="unspecified">Unspecified</option>
          {institutions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.archivedAt ? " (archived)" : ""}
            </option>
          ))}
        </Select>
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          aria-label="Filter by asset type"
        >
          <option value="all">Assets & liabilities</option>
          <option value="asset">Assets</option>
          <option value="liability">Liabilities</option>
        </Select>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All status</option>
        </Select>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Sort accounts"
        >
          <option value="value">Value</option>
          <option value="name">Name</option>
          <option value="category">Category</option>
          <option value="change">Recent change</option>
          <option value="updated">Last updated</option>
        </Select>
        <div className="flex rounded-xl border border-white/10 p-1">
          <Button
            type="button"
            variant={view === "cards" ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setView("cards")}
            aria-label="Card view"
          >
            <Grid2X2 size={17} />
          </Button>
          <Button
            type="button"
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setView("table")}
            aria-label="Table view"
          >
            <List size={18} />
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-slate-400">
          No accounts match these filters.
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((account) => (
            <Link
              key={account.id}
              href={`/accounts/${account.id}`}
              className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Card className="h-full p-5 transition-colors group-hover:border-emerald-400/25 group-hover:bg-[var(--panel-raised)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl bg-white/[0.05] p-2.5 text-slate-300">
                      <CategoryIcon name={account.categoryIcon} size={19} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-100">
                        {account.name}
                      </h2>
                      <p className="truncate text-xs text-slate-500">
                        {account.institution || account.categoryName}
                        {account.institutionArchivedAt
                          ? " · Archived institution"
                          : ""}
                      </p>
                    </div>
                  </div>
                  {account.archivedAt ? (
                    <Badge>Archived</Badge>
                  ) : account.isLiability ? (
                    <Badge tone="negative">Liability</Badge>
                  ) : account.trackingMode === "positions" ? (
                    <Badge
                      tone={
                        account.priceState === "complete"
                          ? "positive"
                          : "warning"
                      }
                    >
                      {account.positionCount} position
                      {account.positionCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-7">
                  <MoneyValue
                    amount={account.currentValueMinor}
                    currency={account.currency}
                    className="text-2xl font-semibold tracking-tight text-white"
                  />
                  {account.currency !== baseCurrency ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {account.convertedValueMinor === null ? (
                        "Exchange rate needed"
                      ) : (
                        <>
                          <MoneyValue
                            amount={account.convertedValueMinor}
                            currency={baseCurrency}
                          />{" "}
                          in base currency
                        </>
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="mt-5 flex items-end justify-between border-t border-white/[0.06] pt-4 text-xs">
                  <div>
                    <p className="text-slate-500">30-day change</p>
                    <p
                      className={
                        (account.monthlyChangeMinor ?? 0) >= 0
                          ? "mt-1 flex items-center gap-1 text-emerald-300"
                          : "mt-1 flex items-center gap-1 text-red-300"
                      }
                    >
                      {account.monthlyChangeMinor === null ? (
                        "Rate needed"
                      ) : (
                        <>
                          {account.monthlyChangeMinor >= 0 ? (
                            <ArrowUpRight size={13} />
                          ) : (
                            <ArrowDownRight size={13} />
                          )}
                          <MoneyValue
                            amount={account.monthlyChangeMinor}
                            currency={baseCurrency}
                          />
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right text-slate-500">
                    <p>{account.goalName || account.categoryName}</p>
                    {account.trackingMode === "positions" ? (
                      <p className="mt-1 capitalize">
                        {account.priceState === "not_applicable"
                          ? ""
                          : `${account.priceState} prices`}
                      </p>
                    ) : null}
                    {account.positionValueAsOf ? (
                      <p className="mt-1">
                        Value as of{" "}
                        {formatDate(
                          account.positionValueAsOf,
                          timezone,
                          dateFormat,
                        )}
                      </p>
                    ) : null}
                    <p className="mt-1">
                      {formatDate(account.updatedAt, timezone, dateFormat)}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-4">Account</th>
                <th className="p-4">Category</th>
                <th className="p-4">Value</th>
                <th className="p-4">Base value</th>
                <th className="p-4">30-day change</th>
                <th className="p-4">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {visible.map((account) => (
                <tr key={account.id} className="hover:bg-white/[0.025]">
                  <td className="p-4">
                    <Link
                      href={`/accounts/${account.id}`}
                      className="font-medium text-slate-100 hover:text-emerald-300"
                    >
                      {account.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {account.institution}
                      {account.institutionArchivedAt
                        ? " · Archived institution"
                        : ""}
                    </p>
                  </td>
                  <td className="p-4 text-slate-400">{account.categoryName}</td>
                  <td className="p-4">
                    <MoneyValue
                      amount={account.currentValueMinor}
                      currency={account.currency}
                    />
                  </td>
                  <td className="p-4">
                    {account.convertedValueMinor === null ? (
                      <span className="text-amber-300">Rate needed</span>
                    ) : (
                      <MoneyValue
                        amount={account.convertedValueMinor}
                        currency={baseCurrency}
                      />
                    )}
                  </td>
                  <td
                    className={
                      (account.monthlyChangeMinor ?? 0) >= 0
                        ? "p-4 text-emerald-300"
                        : "p-4 text-red-300"
                    }
                  >
                    {account.monthlyChangeMinor === null ? (
                      "—"
                    ) : (
                      <MoneyValue
                        amount={account.monthlyChangeMinor}
                        currency={baseCurrency}
                      />
                    )}
                  </td>
                  <td className="p-4 text-slate-500">
                    {account.positionValueAsOf ? (
                      <>
                        <span className="block">
                          Value as of{" "}
                          {formatDate(
                            account.positionValueAsOf,
                            timezone,
                            dateFormat,
                          )}
                        </span>
                        <span className="mt-1 block text-xs">
                          Updated{" "}
                          {formatDate(account.updatedAt, timezone, dateFormat)}
                        </span>
                      </>
                    ) : (
                      formatDate(account.updatedAt, timezone, dateFormat)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
