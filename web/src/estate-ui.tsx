import {
  Children,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useState,
  useTransition,
} from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "default" | "secondary" | "ghost" | "danger" | "outline";
  size?: "default" | "sm" | "icon";
};

export function Button({
  asChild = false,
  variant = "default",
  size = "default",
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:pointer-events-none disabled:opacity-50",
    variant === "default" &&
      "bg-emerald-400 text-emerald-950 hover:bg-emerald-300",
    variant === "secondary" &&
      "border border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/10",
    variant === "ghost" &&
      "text-slate-300 hover:bg-white/[0.06] hover:text-white",
    variant === "danger" &&
      "bg-red-500/15 text-red-300 hover:bg-red-500/25",
    variant === "outline" &&
      "border border-white/15 bg-transparent text-slate-100 hover:bg-white/[0.06]",
    size === "default" && "h-11",
    size === "sm" && "min-h-9 rounded-lg px-3 text-xs",
    size === "icon" && "h-11 w-11 px-0",
    className,
  );
  if (asChild) {
    const child = Children.only(children) as ReactElement<{
      className?: string;
    }>;
    return isValidElement(child)
      ? cloneElement(child, {
          className: cn(classes, child.props.className),
        })
      : null;
  }
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
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
      className={cn(
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
      className={cn("text-sm font-semibold text-slate-100", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-3", className)} {...props} />;
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
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-xl border border-white/10 bg-[var(--panel-raised)] px-3 text-sm text-slate-100 outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-sm font-medium text-slate-300",
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-xs text-red-300">{children}</p>;
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-300",
        className,
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-white/20 bg-black/20 accent-emerald-400"
        {...props}
      />
      {label}
    </label>
  );
}

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
          {description}
        </p>
      </div>
    </header>
  );
}

export function MutationButton({
  action,
  confirm,
  successMessage,
  children,
  ...props
}: ButtonProps & {
  action: () => Promise<void>;
  confirm?: string;
  successMessage?: string;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  return (
    <>
      <Button
        type="button"
        data-financial-mutation="true"
        disabled={pending}
        {...props}
        onClick={() => {
          if (!navigator.onLine) {
            toast.error("Reconnect before making financial changes.");
            return;
          }
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            try {
              await action();
              setMessage(undefined);
              if (successMessage) toast.success(successMessage);
            } catch (error) {
              const errorMessage =
                error instanceof Error
                  ? error.message
                  : "The estate plan could not be changed.";
              setMessage(errorMessage);
              toast.error(errorMessage);
            }
          });
        }}
      >
        {pending ? <LoaderCircle className="animate-spin" size={16} /> : children}
      </Button>
      {message ? (
        <span className="sr-only" role="alert">
          {message}
        </span>
      ) : null}
    </>
  );
}