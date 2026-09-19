import { createContext, useContext, type ReactNode } from "react";

import { formatMinorUnits } from "./format";

const MASKED_VALUE = "••••••";

const PrivacyContext = createContext(false);

export function PrivacyBoundary({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  return (
    <PrivacyContext.Provider value={hidden}>{children}</PrivacyContext.Provider>
  );
}

export function MoneyValue({
  amount,
  currency,
  className,
}: {
  amount: string;
  currency: string;
  className?: string;
}) {
  const hidden = useContext(PrivacyContext);
  return (
    <span className={hidden ? `${className ?? ""} masked`.trim() : className}>
      {hidden ? MASKED_VALUE : formatMinorUnits(amount, currency)}
    </span>
  );
}

export function PrivateValue({ children, className }: { children: ReactNode; className?: string }) {
  const hidden = useContext(PrivacyContext);
  return <span className={hidden ? `${className ?? ""} masked`.trim() : className}>{hidden ? MASKED_VALUE : children}</span>;
}
