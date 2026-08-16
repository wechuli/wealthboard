"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_COLORS } from "@/lib/constants";
import { usePrivacy } from "@/components/privacy-provider";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const axisStyle = { fill: "var(--muted)", fontSize: 11 };
const tooltipStyle = {
  background: "var(--chart-tooltip)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text-primary)",
};

function HiddenChart({ height = "h-64" }: { height?: string }) {
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-white/[0.02] text-sm text-slate-500", height)}>
      Financial chart hidden
    </div>
  );
}

function compact(value: number, currency: string) {
  return formatMoney(value, currency, { compact: true });
}

export function NetWorthChart({
  data,
  currency,
  range,
}: {
  data: Array<{ date: string; netWorth: number; assets: number; liabilities: number }>;
  currency: string;
  range: string;
}) {
  const { hidden } = usePrivacy();
  const ranges = [
    ["1m", "1M"],
    ["3m", "3M"],
    ["6m", "6M"],
    ["1y", "1Y"],
    ["all", "All"],
  ];
  if (data.length < 2) {
    return (
      <div className="flex h-72 items-center justify-center text-center text-sm text-slate-500">
        Add an account and update it over time to build your net-worth history.
      </div>
    );
  }
  if (hidden) return <HiddenChart height="h-72" />;
  return (
    <div>
      <div className="mb-4 flex justify-end gap-1">
        {ranges.map(([value, label]) => (
          <Link
            key={value}
            href={`/?range=${value}`}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-200",
              range === value && "bg-white/[0.07] text-slate-100",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      <p className="sr-only">
        Net worth moved from {formatMoney(data[0].netWorth, currency)} to{" "}
        {formatMoney(data.at(-1)!.netWorth, currency)} during this period.
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="net-worth-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDate(value, "UTC", "MMM yy")}
              axisLine={false}
              tickLine={false}
              tick={axisStyle}
              minTickGap={38}
            />
            <YAxis
              tickFormatter={(value: number) => compact(value, currency)}
              axisLine={false}
              tickLine={false}
              tick={axisStyle}
              width={72}
            />
            <Tooltip
              contentStyle={{ ...tooltipStyle, fontSize: 12 }}
              labelFormatter={(value) => formatDate(String(value), "UTC", "dd MMM yyyy")}
              formatter={(value, name) => [
                formatMoney(Number(value ?? 0), currency),
                String(name).replace(/([A-Z])/g, " $1"),
              ]}
            />
            <Area
              type="monotone"
              dataKey="netWorth"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              fill="url(#net-worth-fill)"
              animationDuration={500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AccountHistoryChart({
  data,
  currency,
}: {
  data: Array<{ date: string; value: number }>;
  currency: string;
}) {
  const { hidden } = usePrivacy();
  if (hidden) return <HiddenChart />;
  if (data.length < 2) {
    return <div className="flex h-56 items-center justify-center text-sm text-slate-500">More history is needed for a chart.</div>;
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value: string) => formatDate(value, "UTC", "MMM yy")} axisLine={false} tickLine={false} tick={axisStyle} />
          <YAxis tickFormatter={(value: number) => compact(value, currency)} axisLine={false} tickLine={false} tick={axisStyle} width={70} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value) => formatDate(String(value), "UTC", "dd MMM yyyy")}
            formatter={(value) => [formatMoney(Number(value ?? 0), currency), "Value"]}
          />
          <Area type="stepAfter" dataKey="value" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.1} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationChart({
  total,
  investible,
  currency,
}: {
  total: Array<{ name: string; value: number }>;
  investible: Array<{ name: string; value: number }>;
  currency: string;
}) {
  const { hidden: valuesHidden } = usePrivacy();
  const [mode, setMode] = useState<"total" | "investible">("total");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const source = mode === "total" ? total : investible;
  const data = source.filter((item) => !hidden.has(item.name));
  const sum = source.reduce((accumulator, item) => accumulator + item.value, 0);
  if (valuesHidden) return <HiddenChart />;
  return (
    <div>
      <div className="mb-3 flex gap-1">
        {(["total", "investible"] as const).map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => setMode(value)}
            className={cn(
              "min-h-9 rounded-lg px-3 text-xs font-medium capitalize text-slate-500",
              mode === value && "bg-white/[0.07] text-slate-100",
            )}
          >
            {value === "total" ? "Total allocation" : "Investible only"}
          </button>
        ))}
      </div>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">No assets to allocate yet.</div>
      ) : (
        <>
          <p className="sr-only">
            {data.map((item) => `${item.name}: ${Math.round((item.value / sum) * 100)} percent`).join(", ")}
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="84%" paddingAngle={2}>
                  {data.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [formatMoney(Number(value ?? 0), currency), "Value"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2" aria-label="Allocation legend">
            {source.map((item, index) => (
              <button
                key={item.name}
                type="button"
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(item.name)) next.delete(item.name);
                    else next.add(item.name);
                    return next;
                  })
                }
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-xs text-slate-400 hover:bg-white/[0.05]",
                  hidden.has(item.name) && "opacity-40",
                )}
                aria-pressed={!hidden.has(item.name)}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                {item.name} · {sum ? Math.round((item.value / sum) * 100) : 0}%
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AssetsLiabilitiesChart({
  assets,
  liabilities,
  currency,
}: {
  assets: number;
  liabilities: number;
  currency: string;
}) {
  const { hidden } = usePrivacy();
  if (hidden) return <HiddenChart height="h-48" />;
  const data = [{ name: "Current", Assets: assets, Liabilities: liabilities }];
  return (
    <div className="h-48">
      <p className="sr-only">Assets are {formatMoney(assets, currency)} and liabilities are {formatMoney(liabilities, currency)}.</p>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [formatMoney(Number(value ?? 0), currency)]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Assets" stackId="value" fill="var(--chart-1)" radius={[8, 0, 0, 8]} />
          <Bar dataKey="Liabilities" stackId="value" fill="var(--negative)" radius={[0, 8, 8, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ContributionsGrowthChart({
  values,
  currency,
}: {
  values: Array<{ name: string; value: number }>;
  currency: string;
}) {
  const { hidden } = usePrivacy();
  if (hidden) return <HiddenChart />;
  return (
    <div className="h-64">
      <p className="sr-only">{values.map((item) => `${item.name}: ${formatMoney(item.value, currency)}`).join(", ")}</p>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={values} margin={{ left: 4, right: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(value: number) => compact(value, currency)} tick={axisStyle} axisLine={false} tickLine={false} width={72} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [formatMoney(Number(value ?? 0), currency), "Amount"]}
          />
          <Bar dataKey="value" radius={[7, 7, 0, 0]}>
            {values.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GoalProjectionChart({
  data,
  currency,
}: {
  data: Array<{ date: string; projected: number; contributions: number; target: number }>;
  currency: string;
}) {
  const { hidden } = usePrivacy();
  if (hidden) return <HiddenChart height="h-72" />;
  return (
    <div className="h-72">
      <p className="sr-only">Estimated goal projection based on the configured contribution and return assumption.</p>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value: string) => formatDate(value, "UTC", "MMM yy")} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={30} />
          <YAxis tickFormatter={(value: number) => compact(value, currency)} tick={axisStyle} axisLine={false} tickLine={false} width={72} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [formatMoney(Number(value ?? 0), currency), String(name)]}
          />
          <Area type="monotone" dataKey="projected" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} strokeWidth={2} />
          <Area type="monotone" dataKey="contributions" stroke="var(--chart-2)" fill="transparent" strokeDasharray="4 4" />
          <ReferenceLine y={data[0]?.target ?? 0} stroke="var(--warning)" strokeDasharray="5 5" label={{ value: "Target", fill: "var(--warning)", fontSize: 11 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
