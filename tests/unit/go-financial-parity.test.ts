import { describe, expect, it } from "vitest";

import type { TransactionType } from "@/db/schema";
import { isIsoCurrencyCode } from "@/lib/currencies";
import {
  calculateFlowMetrics,
  calculateNetWorthTotals,
  replayBalance,
  transactionEffect,
  type FinancialEvent,
} from "@/lib/finance";
import { canonicalDecimal } from "@/lib/investments";
import {
  convertMinor,
  currencyDigits,
  minorToDecimalString,
  parseMoney,
  selectExchangeRate,
} from "@/lib/money";
import fixtures from "../fixtures/go-financial-parity.json";

const stringValues = (values: Record<string, bigint>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.toString()]),
  );

describe("Go financial foundation shared parity contract", () => {
  it("pins the complete Intl currency catalog and its actual fraction digits", () => {
    const codes = Object.values(fixtures.currencyGroups).flatMap((group) =>
      group.split(" "),
    );
    expect(codes.toSorted()).toEqual(Intl.supportedValuesOf("currency").toSorted());
    for (const [digits, group] of Object.entries(fixtures.currencyGroups)) {
      for (const code of group.split(" ")) {
        expect(isIsoCurrencyCode(code)).toBe(true);
        expect(currencyDigits(code)).toBe(Number(digits));
      }
    }
    expect(isIsoCurrencyCode("ZZZ")).toBe(false);
  });

  it.each(fixtures.money)("parses $name", (fixture) => {
    const parse = () => parseMoney(fixture.input, fixture.currency).toString();
    if (fixture.error) expect(parse).toThrow();
    else expect(parse()).toBe(fixture.expected);
    if (fixture.digits !== undefined) {
      expect(currencyDigits(fixture.currency)).toBe(fixture.digits);
      expect(isIsoCurrencyCode(fixture.currency)).toBe(false);
    }
  });

  it.each(fixtures.format)("formats $amount $currency", (fixture) => {
    expect(
      minorToDecimalString(BigInt(fixture.amount), fixture.currency),
    ).toBe(fixture.expected);
  });

  it.each(fixtures.decimals)("canonicalizes $input", (fixture) => {
    const parse = () =>
      canonicalDecimal(fixture.input, {
        label: "decimal",
        allowNegative: true,
        allowZero: true,
      });
    if (fixture.error) expect(parse).toThrow();
    else expect(parse()).toBe(fixture.expected);
  });

  it.each(fixtures.signs)("applies both signs for $type", (fixture) => {
    const type = fixture.type as TransactionType;
    expect(transactionEffect(type, 123).toString()).toBe(fixture.positive);
    expect(transactionEffect(type, -123).toString()).toBe(fixture.negative);
    expect(transactionEffect(type, 0).toString()).toBe("0");
  });

  it.each(fixtures.conversions)("converts $name", (fixture) => {
    const convert = () =>
      convertMinor(
        BigInt(fixture.amount),
        fixture.from,
        fixture.to,
        fixture.rates,
        fixture.asOf,
      ).toString();
    if (fixture.error) expect(convert).toThrow();
    else expect(convert()).toBe(fixture.expected);
    if (fixture.selected !== undefined) {
      const selected = selectExchangeRate(
        fixture.from,
        fixture.to,
        fixture.rates,
        fixture.asOf,
      );
      expect(selected?.rate.rate).toBe(fixture.selected);
      expect(selected?.inverse).toBe(fixture.inverse);
    } else if (fixture.error) {
      expect(
        selectExchangeRate(
          fixture.from,
          fixture.to,
          fixture.rates,
          fixture.asOf,
        ),
      ).toBeNull();
    }
    // TS bigint is unbounded; the Go API deliberately rejects this result.
    if (fixture.goRangeError) {
      expect(BigInt(fixture.expected!)).toBeGreaterThan(9223372036854775807n);
    }
  });

  it.each(fixtures.replays)("replays $name", (fixture) => {
    const events: FinancialEvent[] = fixture.events.map((event) =>
      event.kind === "valuation"
        ? {
            kind: "valuation",
            date: event.date,
            createdAt: event.createdAt,
            valueMinor: Number(event.valueMinor),
          }
        : {
            kind: "transaction",
            date: event.date,
            createdAt: event.createdAt,
            type: event.type as TransactionType,
            amountMinor: Number(event.amountMinor),
          },
    );
    const original = structuredClone(events);
    expect(replayBalance(events, fixture.throughDate).toString()).toBe(
      fixture.expected,
    );
    expect(events).toEqual(original);
  });

  it("separates contributions from gains, transfers and adjustments", () => {
    expect(
      stringValues(
        calculateFlowMetrics(
          fixtures.flows.entries.map((entry) => ({
            type: entry.type as TransactionType,
            amountMinor: BigInt(entry.amountMinor),
          })),
        ),
      ),
    ).toEqual(fixtures.flows.expected);
  });

  it("subtracts liabilities and excludes opted-out holdings", () => {
    expect(
      stringValues(
        calculateNetWorthTotals(
          fixtures.netWorth.holdings.map((holding) => ({
            ...holding,
            valueMinor: BigInt(holding.valueMinor),
          })),
        ),
      ),
    ).toEqual(fixtures.netWorth.expected);
  });
});
