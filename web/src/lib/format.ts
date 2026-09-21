export function formatMinorUnits(value: string, currency: string): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(3, "0");
  const whole = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = padded.slice(-2);
  return `${negative ? "-" : ""}${currency} ${whole}.${fraction}`;
}

export function minorUnitsToDecimal(value: string): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(3, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

export function decimalToMinorUnits(value: string): string | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return (BigInt(whole) * 100n + BigInt(fraction || "0")).toString();
}
