import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Progress,
} from "@/components/ui/original";

describe("original UI primitives", () => {
  it("preserves the Next.js card and form markup classes", () => {
    render(
      <Card data-testid="card">
        <CardHeader data-testid="header">
          <div>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Personal settings</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" />
          <Button variant="secondary">Save</Button>
        </CardContent>
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveClass(
      "rounded-2xl",
      "bg-[var(--panel)]",
    );
    expect(screen.getByTestId("header")).toHaveClass("p-5", "pb-2");
    expect(screen.getByRole("heading", { name: "Preferences" })).toHaveClass(
      "text-sm",
    );
    expect(screen.getByText("Personal settings")).toHaveClass(
      "mt-1",
      "text-slate-400",
    );
    expect(screen.getByLabelText("Display name")).toHaveClass(
      "min-h-11",
      "bg-black/20",
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "border-white/10",
    );
  });

  it("preserves empty-state structure and progress semantics", () => {
    render(
      <>
        <EmptyState
          icon={<span>+</span>}
          title="No goals"
          description="Create your first goal."
        />
        <Progress value={120} label="Goal progress" className="mt-4" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "No goals" })).toHaveClass(
      "text-slate-100",
    );
    expect(screen.getByText("Create your first goal.")).toHaveClass("max-w-sm");
    expect(
      screen.getByRole("progressbar", { name: "Goal progress" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });
});
