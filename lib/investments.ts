import Decimal from "decimal.js";

import type { PositionEventType } from "@/db/schema";
import { currencyDigits } from "@/lib/money";

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export class InvalidPositionSequenceError extends Error {
  constructor(
    public readonly instrumentId: string,
    public readonly eventDate: string,
  ) {
    super("A position cannot have a negative quantity.");
    this.name = "InvalidPositionSequenceError";
  }
}

export class InvalidCorporateActionSequenceError extends Error {
  constructor(
    public readonly instrumentId: string,
    public readonly eventDate: string,
  ) {
    super(
      "This change would invalidate a recorded corporate action. Delete the affected action before correcting earlier holdings, then record it again.",
    );
    this.name = "InvalidCorporateActionSequenceError";
  }
}

export function canonicalDecimal(
  value: string,
  options: {
    label: string;
    allowNegative?: boolean;
    allowZero?: boolean;
  },
) {
  const normalized = value.trim().replaceAll(",", "");
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new Error(`Enter a valid ${options.label}.`);
  }
  const decimal = new Decimal(normalized);
  if (!options.allowNegative && decimal.isNegative()) {
    throw new Error(`${options.label} cannot be negative.`);
  }
  if (!options.allowZero && decimal.isZero()) {
    throw new Error(`${options.label} must be greater than zero.`);
  }
  return decimal.toString();
}

export type PositionEventLike = {
  id: string;
  instrumentId: string;
  relatedInstrumentId?: string | null;
  type: PositionEventType;
  quantity: string;
  tradeDate: string;
  eventSequence?: number;
  actionRatioNumerator?: string | null;
  actionRatioDenominator?: string | null;
  createdAt: string;
};

function quantityEffect(event: PositionEventLike) {
  const quantity = new Decimal(event.quantity);
  if (
    event.type === "sell" ||
    event.type === "transfer_out" ||
    event.type === "merger_out"
  ) {
    return quantity.abs().negated();
  }
  if (event.type === "quantity_adjustment") return quantity;
  if (event.type === "split") return new Decimal(0);
  return quantity.abs();
}

function splitQuantity(current: Decimal, event: PositionEventLike) {
  const numerator = new Decimal(event.actionRatioNumerator ?? 0);
  const denominator = new Decimal(event.actionRatioDenominator ?? 0);
  if (!numerator.isPositive() || !denominator.isPositive()) {
    throw new Error("A stock split requires a positive ratio.");
  }
  return current.mul(numerator).div(denominator);
}

export function orderPositionEvents<T extends PositionEventLike>(
  events: T[],
  throughDate?: string,
) {
  return [...events]
    .filter((event) => !throughDate || event.tradeDate <= throughDate)
    .sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        (left.eventSequence ?? 0) - (right.eventSequence ?? 0) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export function applyPositionEventQuantity(
  current: Decimal,
  event: PositionEventLike,
) {
  return event.type === "split"
    ? splitQuantity(current, event)
    : current.add(quantityEffect(event));
}

export function replayPositionQuantities(
  events: PositionEventLike[],
  throughDate?: string,
  options: { validateCorporateActions?: boolean } = {},
) {
  const quantities = new Map<string, Decimal>();
  const ordered = orderPositionEvents(events, throughDate);

  for (const event of ordered) {
    const current = quantities.get(event.instrumentId) ?? new Decimal(0);
    const next = applyPositionEventQuantity(current, event);
    if (next.isNegative()) {
      throw new InvalidPositionSequenceError(
        event.instrumentId,
        event.tradeDate,
      );
    }
    if (options.validateCorporateActions) {
      let expectedQuantity: Decimal | null = null;
      if (event.type === "spinoff") {
        const sourceQuantity =
          quantities.get(event.relatedInstrumentId ?? "") ?? new Decimal(0);
        expectedQuantity = splitQuantity(sourceQuantity, event);
      } else if (event.type === "merger_out") {
        expectedQuantity = current;
      }
      if (expectedQuantity && !expectedQuantity.equals(event.quantity)) {
        throw new InvalidCorporateActionSequenceError(
          event.instrumentId,
          event.tradeDate,
        );
      }
    }
    quantities.set(event.instrumentId, next);
  }

  return new Map(
    [...quantities.entries()].map(([instrumentId, quantity]) => [
      instrumentId,
      quantity.toString(),
    ]),
  );
}

export function calculateQuoteValueMinor(
  quantity: string,
  unitPrice: string,
  currency: string,
) {
  const scale = new Decimal(10).pow(currencyDigits(currency));
  const value = new Decimal(quantity).mul(unitPrice).mul(scale);
  return BigInt(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

export function selectPositionPrice<
  Price extends { instrumentId: string; effectiveDate: string },
>(
  instrumentId: string,
  prices: Price[],
  events: PositionEventLike[],
  throughDate: string,
) {
  const latestSplitDate = events
    .filter(
      (event) =>
        event.instrumentId === instrumentId &&
        event.type === "split" &&
        event.tradeDate <= throughDate,
    )
    .map((event) => event.tradeDate)
    .sort()
    .at(-1);
  const latestPrice = prices
    .filter(
      (price) =>
        price.instrumentId === instrumentId &&
        price.effectiveDate <= throughDate,
    )
    .sort((left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate),
    )[0];
  const price =
    latestPrice &&
    (!latestSplitDate || latestPrice.effectiveDate >= latestSplitDate)
      ? latestPrice
      : undefined;
  return { price, latestPrice, latestSplitDate };
}

export function convertMinorWithAppliedRate(
  amountMinor: number | bigint,
  fromCurrency: string,
  toCurrency: string,
  appliedRate: string,
) {
  const sourceMajor = new Decimal(amountMinor.toString()).div(
    new Decimal(10).pow(currencyDigits(fromCurrency)),
  );
  const targetMinor = sourceMajor
    .mul(appliedRate)
    .mul(new Decimal(10).pow(currencyDigits(toCurrency)));
  return BigInt(
    targetMinor.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0),
  );
}
