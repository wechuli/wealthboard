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
  type: PositionEventType;
  quantity: string;
  tradeDate: string;
  createdAt: string;
};

function quantityEffect(event: PositionEventLike) {
  const quantity = new Decimal(event.quantity);
  if (event.type === "sell") return quantity.abs().negated();
  if (event.type === "quantity_adjustment") return quantity;
  return quantity.abs();
}

export function replayPositionQuantities(
  events: PositionEventLike[],
  throughDate?: string,
) {
  const quantities = new Map<string, Decimal>();
  const ordered = [...events]
    .filter((event) => !throughDate || event.tradeDate <= throughDate)
    .sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );

  for (const event of ordered) {
    const next = (quantities.get(event.instrumentId) ?? new Decimal(0)).add(
      quantityEffect(event),
    );
    if (next.isNegative()) {
      throw new InvalidPositionSequenceError(
        event.instrumentId,
        event.tradeDate,
      );
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
