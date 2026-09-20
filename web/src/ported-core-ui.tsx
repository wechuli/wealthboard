import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classes(
        "rounded-2xl border border-white/[0.08] bg-[var(--panel)] shadow-[0_16px_45px_var(--shadow)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classes(
        "flex items-start justify-between gap-4 p-5 pb-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={classes("text-sm font-semibold text-slate-100", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("p-5 pt-3", className)} {...props} />;
}

type ButtonVariant = "default" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "default" | "sm" | "icon";

const buttonVariantClasses: Record<ButtonVariant, string> = {
  default: "bg-emerald-400 text-emerald-950 hover:bg-emerald-300",
  secondary:
    "border border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/10",
  ghost: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
  danger: "bg-red-500/15 text-red-300 hover:bg-red-500/25",
  outline:
    "border border-white/15 bg-transparent text-slate-100 hover:bg-white/[0.06]",
};

const buttonSizeClasses: Record<ButtonSize, string> = {
  default: "h-11",
  sm: "min-h-9 rounded-lg px-3 text-xs",
  icon: "h-11 w-11 px-0",
};

export function Button({
  asChild = false,
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const resolvedClassName = classes(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:pointer-events-none disabled:opacity-50",
    buttonVariantClasses[variant],
    buttonSizeClasses[size],
    className,
  );

  if (asChild) {
    const child = Children.only(children);
    if (!isValidElement<{ className?: string }>(child)) return null;
    return cloneElement(child, {
      ...props,
      className: classes(resolvedClassName, child.props.className),
    });
  }

  return (
    <button className={resolvedClassName} {...props}>
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "positive" | "warning" | "negative" | "info";
}) {
  const tones = {
    neutral: "bg-white/[0.06] text-slate-300",
    positive: "bg-emerald-400/10 text-emerald-300",
    warning: "bg-amber-400/10 text-amber-300",
    negative: "bg-red-400/10 text-red-300",
    info: "bg-cyan-400/10 text-cyan-300",
  };
  return (
    <span
      className={classes(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center">
      <div className="mb-4 rounded-2xl bg-white/[0.05] p-3 text-slate-400">
        {icon}
      </div>
      <h3 className="font-semibold text-slate-100">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={classes(
      "min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={classes(
      "min-h-11 w-full rounded-xl border border-white/10 bg-[var(--panel-raised)] px-3 text-sm text-slate-100 outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={classes(
        "mb-1.5 block text-sm font-medium text-slate-300",
        className,
      )}
      {...props}
    />
  );
}

export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div
      className={classes("h-2 overflow-hidden rounded-full bg-white/[0.07]", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
    >
      <span
        className="block h-full rounded-full bg-emerald-400"
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}

export type PortedLinkElement = ReactElement<{ className?: string }>;