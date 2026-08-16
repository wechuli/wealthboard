"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  themePreferences,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(preference: ThemePreference) {
  const resolvedTheme = resolveTheme(preference, getSystemTheme());
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;

  let themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]:not([media])',
  );
  if (!themeColor) {
    themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    document.head.append(themeColor);
  }
  themeColor.content = resolvedTheme === "dark" ? "#090d0d" : "#f4f7f6";
  return resolvedTheme;
}

const serverSnapshot = "system:dark";

function getThemeSnapshot() {
  const root = document.documentElement;
  const preference = parseThemePreference(root.dataset.themePreference);
  const resolvedTheme =
    root.dataset.theme === "light" ? "light" : "dark";
  return `${preference}:${resolvedTheme}`;
}

function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (
      parseThemePreference(
        document.documentElement.dataset.themePreference,
      ) === "system"
    ) {
      applyTheme("system");
      onChange();
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(parseThemePreference(event.newValue));
    onChange();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("wealthboard-theme-change", onChange);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("wealthboard-theme-change", onChange);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    () => serverSnapshot,
  );
  const [savedPreference, savedResolvedTheme] = snapshot.split(":");
  const preference = parseThemePreference(savedPreference);
  const resolvedTheme: ResolvedTheme =
    savedResolvedTheme === "light" ? "light" : "dark";

  const setPreference = (next: ThemePreference) => {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    window.dispatchEvent(new Event("wealthboard-theme-change"));
  };

  return (
    <ThemeContext.Provider
      value={{ preference, resolvedTheme, setPreference }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

const icons = {
  system: Laptop,
  light: Sun,
  dark: Moon,
};

const labels = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeControl({
  variant = "compact",
}: {
  variant?: "compact" | "settings";
}) {
  const { preference, resolvedTheme, setPreference } = useTheme();

  if (variant === "settings") {
    return (
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-300">
          Appearance
        </legend>
        <div
          className="grid grid-cols-3 gap-2"
          aria-label={`Appearance: ${labels[preference]}, resolved ${resolvedTheme}`}
        >
          {themePreferences.map((value) => {
            const Icon = icons[value];
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => setPreference(value)}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                  selected && "bg-emerald-400/10 text-emerald-300",
                )}
              >
                <Icon size={17} aria-hidden />
                {labels[value]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500" aria-live="polite">
          {preference === "system"
            ? `Following this device (${resolvedTheme}).`
            : `${labels[preference]} appearance is active.`}
        </p>
      </fieldset>
    );
  }

  const Icon = icons[preference];
  const index = themePreferences.indexOf(preference);
  const next = themePreferences[(index + 1) % themePreferences.length];
  const description = `${labels[preference]} appearance, resolved ${resolvedTheme}. Switch to ${labels[next]}.`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={description}
      title={description}
      onClick={() => setPreference(next)}
    >
      <Icon size={18} aria-hidden />
    </Button>
  );
}

export function ThemeToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster theme={resolvedTheme} richColors position="top-right" />
  );
}
