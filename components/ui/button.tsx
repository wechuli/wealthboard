import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-emerald-400 text-emerald-950 hover:bg-emerald-300",
        secondary: "border border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/10",
        ghost: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
        danger: "bg-red-500/15 text-red-300 hover:bg-red-500/25",
        outline: "border border-white/15 bg-transparent text-slate-100 hover:bg-white/[0.06]",
      },
      size: {
        default: "h-11",
        sm: "min-h-9 rounded-lg px-3 text-xs",
        icon: "h-11 w-11 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
