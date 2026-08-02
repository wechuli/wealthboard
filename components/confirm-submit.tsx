"use client";

import type { ButtonHTMLAttributes } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

export function ConfirmSubmit({
  message,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonProps & {
    message: string;
  }) {
  return (
    <Button
      {...props}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
