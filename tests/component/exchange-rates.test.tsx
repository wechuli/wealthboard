import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ExchangeRateManager } from "@/components/exchange-rate-manager";
import {
  CurrentExchangeRateWarnings,
  HistoricalExchangeRateWarnings,
} from "@/components/exchange-rate-warnings";
import { exchangeRateAction } from "@/app/(app)/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/actions", () => ({
  exchangeRateAction: vi.fn(async () => ({ ok: true })),
  deleteExchangeRateAction: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => vi.stubGlobal("requestAnimationFrame", vi.fn()));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const latest = {
  id: "a9c8c7ad-8452-409f-ad98-55a78503d90a",
  baseCurrency: "USD",
  quoteCurrency: "KES",
  rate: "129.40",
  effectiveDate: "2026-09-01T12:00:00.000Z",
  source: "manual",
};
const preferences = { timezone: "Africa/Nairobi", dateFormat: "dd MMM yyyy" };
const props = {
  ...preferences,
  today: "2026-09-06",
  enabledCurrencies: ["USD", "KES"],
  baseCurrency: "KES",
  groups: [
    {
      key: "KES/USD",
      latest,
      history: [latest],
      status: "Up to date",
      needsReview: false,
    },
  ],
};

test("distinguishes current missing rates, stale rates, and historical gaps with targeted links", () => {
  render(
    <>
      <CurrentExchangeRateWarnings
        {...preferences}
        issues={[
          {
            baseCurrency: "USD",
            quoteCurrency: "KES",
            status: "stale",
            rate: "130",
            effectiveDate: "2026-08-01T12:00:00.000Z",
          },
        ]}
      />
      <HistoricalExchangeRateWarnings
        {...preferences}
        currentComplete
        gaps={[
          {
            baseCurrency: "USD",
            quoteCurrency: "KES",
            affectedFrom: "2026-01-01T12:00:00.000Z",
            affectedTo: "2026-08-01T12:00:00.000Z",
          },
        ]}
      />
    </>,
  );
  expect(screen.getByText("USD/KES rate is over a month old.")).toBeVisible();
  expect(screen.getByText(/Your current total is complete/)).toBeVisible();
  expect(
    screen.queryByText("Current total is incomplete."),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Add earlier USD/KES rate" }),
  ).toHaveAttribute(
    "href",
    "/settings?rateBase=USD&rateQuote=KES&rateDate=2026-01-01#exchange-rates",
  );
  expect(screen.getByRole("link", { name: "Update USD/KES" })).toHaveAttribute(
    "href",
    "/settings?rateBase=USD&rateQuote=KES#exchange-rates",
  );
});

test("shows a current missing-rate warning without claiming the total is complete", () => {
  render(
    <CurrentExchangeRateWarnings
      {...preferences}
      issues={[
        { baseCurrency: "USD", quoteCurrency: "KES", status: "missing" },
      ]}
    />,
  );
  expect(screen.getByText("Current total is incomplete.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Add USD/KES rate" })).toBeVisible();
});

test("updates today's rate without submitting a historical entry ID", async () => {
  const user = userEvent.setup();
  render(<ExchangeRateManager {...props} />);
  await user.click(screen.getByRole("button", { name: "Update USD/KES" }));
  expect(screen.getByLabelText("Effective date")).toHaveValue("2026-09-06");
  await user.clear(screen.getByLabelText("Rate (quote per base)"));
  await user.type(screen.getByLabelText("Rate (quote per base)"), "131");
  await user.click(screen.getByRole("button", { name: "Save rate" }));
  await waitFor(() => expect(exchangeRateAction).toHaveBeenCalled());
  const submitted = vi.mocked(exchangeRateAction).mock.calls.at(-1)![1];
  expect(submitted.get("rate")).toBe("131");
  expect(submitted.get("effectiveDate")).toBe("2026-09-06");
  expect(submitted.has("id")).toBe(false);
});

test("corrections target the entry and deletion requires confirmation", async () => {
  render(<ExchangeRateManager {...props} />);
  fireEvent.click(screen.getByText(/USD\/KES history/));
  fireEvent.click(
    screen.getByRole("button", { name: "Edit USD/KES rate from 01 Sep 2026" }),
  );
  expect(screen.getByLabelText("Effective date")).toHaveValue("2026-09-01");
  const editor = screen.getByRole("form", { name: "Correct exchange rate" });
  expect(new FormData(editor as HTMLFormElement).get("id")).toBe(latest.id);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Delete USD/KES rate from 01 Sep 2026",
    }),
  );
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining("Historical totals may become incomplete"),
  );
});

test("earlier-rate links preserve the date and resolve existing inverse pairs without guessing a rate", () => {
  render(
    <ExchangeRateManager
      {...props}
      initial={{
        baseCurrency: "KES",
        quoteCurrency: "USD",
        effectiveDate: "2026-01-01",
      }}
    />,
  );
  expect(screen.getByLabelText("Base currency")).toHaveValue("USD");
  expect(screen.getByLabelText("Quote currency")).toHaveValue("KES");
  expect(screen.getByLabelText("Effective date")).toHaveValue("2026-01-01");
  expect(screen.getByLabelText("Rate (quote per base)")).toHaveValue("");
});
