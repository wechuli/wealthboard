"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const PrivacyContext = createContext<{ hidden: boolean; toggle: () => void }>({
  hidden: false,
  toggle: () => {},
});

export function usePrivacy() {
  return useContext(PrivacyContext);
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      setHidden(localStorage.getItem("wealthboard-values-hidden") === "true");
    });
  }, []);
  const toggle = () =>
    setHidden((current) => {
      localStorage.setItem("wealthboard-values-hidden", String(!current));
      return !current;
    });
  return (
    <PrivacyContext.Provider value={{ hidden, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={hidden ? "Reveal financial values" : "Hide financial values"}
      title={hidden ? "Reveal values" : "Hide values"}
    >
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </Button>
  );
}

export function MoneyValue({
  amount,
  currency,
  compact,
  className,
}: {
  amount: number | bigint;
  currency: string;
  compact?: boolean;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  return (
    <span
      className={cn("tabular-nums", hidden && "tracking-[0.2em]", className)}
    >
      {hidden ? "••••••" : formatMoney(amount, currency, { compact })}
    </span>
  );
}

export function SensitiveValue({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  return (
    <span
      className={cn("tabular-nums", hidden && "tracking-[0.2em]", className)}
    >
      {hidden ? "••••••" : children}
    </span>
  );
}
