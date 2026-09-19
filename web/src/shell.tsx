import {
  BarChart3,
  Building2,
  CandlestickChart,
  CircleDollarSign,
  Eye,
  EyeOff,
  FileBarChart,
  FolderCog,
  Goal,
  Landmark,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  ScrollText,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { PrivacyBoundary } from "./privacy";
import type { Session } from "./types";

export const navigation = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/accounts", label: "Accounts", icon: Landmark },
  { to: "/transactions", label: "Transactions", icon: ReceiptText },
  { to: "/goals", label: "Goals", icon: Goal },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/instruments", label: "Instruments", icon: CandlestickChart },
  { to: "/review", label: "Review", icon: Sparkles },
  { to: "/estate", label: "Estate", icon: ScrollText },
  { to: "/categories", label: "Categories", icon: FolderCog },
  { to: "/institutions", label: "Institutions", icon: Building2 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ session, appName, displayName, onSignOut, children }: { session: Session; appName: string; displayName: string; onSignOut: () => Promise<void>; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(() => localStorage.getItem("wealthboard-values-hidden") === "true");
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("wealthboard-theme") === "light" ? "light" : "dark");
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("wealthboard-theme", theme);
  }, [theme]);
  useEffect(() => localStorage.setItem("wealthboard-values-hidden", String(hidden)), [hidden]);

  return (
    <PrivacyBoundary hidden={hidden}>
      <div className="app-layout">
        <aside className={menuOpen ? "sidebar open" : "sidebar"}>
          <div className="sidebar-brand">
            <span className="brand-mark small"><CircleDollarSign /></span>
            <div><strong>{appName}</strong><span>Private wealth</span></div>
            <button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X /></button>
          </div>
          <nav aria-label="Primary navigation">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === "/"}><Icon /> {label}</NavLink>
            ))}
          </nav>
        </aside>
        {menuOpen ? <button className="nav-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
        <div className="workspace">
          <header className="topbar">
            <button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu /></button>
            <div className="welcome"><strong>Welcome back, {displayName}</strong><span>{session.user.username}</span></div>
            <div className="toolbar">
              <button className="icon-button" aria-label={hidden ? "Show values" : "Hide values"} title={hidden ? "Show values" : "Hide values"} onClick={() => setHidden((value) => !value)}>{hidden ? <Eye /> : <EyeOff />}</button>
              <button className="icon-button" aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun /> : <Moon />}</button>
              <button className="icon-button" aria-label="Log out" onClick={() => void onSignOut()}><LogOut /></button>
            </div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </PrivacyBoundary>
  );
}

export function clearUserState() {
  sessionStorage.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("wealthboard-") && key !== "wealthboard-theme") localStorage.removeItem(key);
  }
  if ("caches" in window) void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("wealthboard-")).map((key) => caches.delete(key))));
}
