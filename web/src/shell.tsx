import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BarChart3,
  CandlestickChart,
  ChevronLeft,
  CircleDollarSign,
  FileBarChart,
  FolderCog,
  Goal,
  Landmark,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  ReceiptText,
  ScrollText,
  Settings,
  Sparkles,
  TrendingUp,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "./ported-ui/button";
import { PrivacyProvider, PrivacyToggle } from "./ported-ui/privacy-provider";
import { PwaManager } from "./ported-ui/pwa-manager";
import {
  ThemeControl,
  ThemeProvider,
  ThemeToaster,
  THEME_STORAGE_KEY,
} from "./ported-ui/theme-provider";
import { cn } from "./ported-ui/utils";
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
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function NavigationLink({
  to,
  label,
  icon: Icon,
  collapsed,
}: (typeof navigation)[number] & { collapsed: boolean }) {
  const { pathname } = useLocation();
  const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
        active && "bg-emerald-400/10 text-emerald-300",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon size={19} aria-hidden />
      {!collapsed ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </Link>
  );
}

function QuickAdd() {
  const [open, setOpen] = useState(false);
  const actions = [
    { to: "/transactions/new?type=deposit", label: "Add deposit", icon: ArrowDownToLine },
    { to: "/transactions/new?type=withdrawal", label: "Add withdrawal", icon: ArrowUpFromLine },
    { to: "/transactions/new?type=interest", label: "Add interest", icon: TrendingUp },
    { to: "/accounts?action=value", label: "Update asset value", icon: Sparkles },
    { to: "/transactions/new?type=transfer", label: "Transfer", icon: ArrowLeftRight },
    { to: "/accounts/new", label: "New account", icon: Landmark },
    { to: "/goals/new", label: "Create goal", icon: Goal },
  ];
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="icon" aria-label="Quick add" className="rounded-full shadow-lg shadow-emerald-950/50">
          <Plus size={21} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-3 bottom-3 z-50 max-h-[85vh] rounded-3xl border border-white/10 bg-[var(--panel-raised)] p-5 shadow-2xl outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div className="flex items-center justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold">Quick add</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-400">
                Record a common action in a few taps.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close quick add"><X size={19} /></Button>
            </Dialog.Close>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {actions.map(({ to, label, icon: Icon }) => (
              <Dialog.Close asChild key={to}>
                <Link to={to} className="flex min-h-14 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 text-sm font-medium text-slate-200 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                  <span className="rounded-lg bg-emerald-400/10 p-2 text-emerald-300"><Icon size={17} /></span>
                  {label}
                </Link>
              </Dialog.Close>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-lg items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-950/95 px-4 py-3 text-sm text-amber-100 shadow-xl">
      <WifiOff size={17} />
      Offline — fresh data and financial changes are unavailable.
    </div>
  );
}

export function AppShell({
  appName,
  displayName,
  onSignOut,
  children,
}: {
  session: Session;
  appName: string;
  displayName: string;
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ThemeProvider>
      <PrivacyProvider>
        <PwaManager />
        <ThemeToaster />
        <OfflineIndicator />
        <div className="min-h-screen">
          <aside className={cn("fixed inset-y-0 left-0 z-30 hidden border-r border-white/[0.07] bg-[var(--panel)] px-3 py-4 backdrop-blur md:flex md:flex-col", collapsed ? "w-20" : "w-64")}>
            <div className={cn("flex h-12 items-center gap-3 px-2", collapsed && "justify-center px-0")}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950"><CircleDollarSign size={21} /></span>
              {!collapsed ? <div className="min-w-0"><p className="truncate font-semibold text-white">{appName}</p><p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Private wealth</p></div> : null}
            </div>
            <nav aria-label="Primary navigation" className="mt-7 flex flex-1 flex-col gap-1">
              {navigation.map((item) => <NavigationLink key={item.to} {...item} collapsed={collapsed} />)}
            </nav>
            <button type="button" className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs text-slate-500 hover:bg-white/[0.04] hover:text-slate-300" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <ChevronLeft size={16} className={cn("transition-transform", collapsed && "rotate-180")} />
              {!collapsed ? "Collapse" : null}
            </button>
          </aside>
          <div className={cn("transition-[padding] md:pl-64", collapsed && "md:pl-20")}>
            <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[var(--background)] px-4 backdrop-blur-xl sm:px-6">
              <div className="flex items-center gap-3 md:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950"><CircleDollarSign size={19} /></span><span className="font-semibold">{appName}</span></div>
              <div className="hidden md:block"><p className="text-sm font-medium text-slate-200">Welcome back, {displayName}</p><p className="text-xs text-slate-500">Your private financial overview</p></div>
              <div className="flex items-center gap-1">
                <PrivacyToggle />
                <ThemeControl />
                <div className="hidden sm:block"><QuickAdd /></div>
                <form onSubmit={(event) => { event.preventDefault(); clearUserState(); void onSignOut(); }}>
                  <Button variant="ghost" size="icon" aria-label="Log out" title="Log out"><LogOut size={18} /></Button>
                </form>
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1600px] px-4 pb-28 pt-6 sm:px-6 md:pb-10 lg:px-8">{children}</main>
          </div>
          <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(4.5rem+env(safe-area-inset-bottom))] grid-cols-5 border-t border-white/10 bg-[var(--panel)] px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
            <MobileLink to="/" label="Home" icon={BarChart3} />
            <MobileLink to="/accounts" label="Accounts" icon={Landmark} />
            <div className="flex items-center justify-center"><QuickAdd /></div>
            <MobileLink to="/goals" label="Goals" icon={Goal} />
            <MobileMore />
          </nav>
        </div>
      </PrivacyProvider>
    </ThemeProvider>
  );
}

function MobileMore() {
  const { pathname } = useLocation();
  const items = [
    { to: "/review", label: "Portfolio review", icon: Sparkles },
    { to: "/reports", label: "Reports", icon: FileBarChart },
    { to: "/instruments", label: "Instruments", icon: CandlestickChart },
    { to: "/estate", label: "Estate planning", icon: ScrollText },
    { to: "/categories", label: "Categories", icon: FolderCog },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
  const active = items.some(({ to }) => pathname.startsWith(to));
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className={cn("flex min-h-11 flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-500", active && "text-emerald-300")} aria-label="More navigation"><MoreHorizontal size={19} />More</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-white/10 bg-[var(--panel-raised)] p-5 shadow-2xl outline-none">
          <div className="flex items-center justify-between"><Dialog.Title className="text-base font-semibold">More</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close navigation"><X size={18} /></Button></Dialog.Close></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {items.map(({ to, label, icon: Icon }) => <Dialog.Close asChild key={to}><Link to={to} className="flex min-h-14 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 text-sm font-medium text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><Icon size={17} className="text-emerald-300" />{label}</Link></Dialog.Close>)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MobileLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Menu }) {
  const { pathname } = useLocation();
  const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
  return <Link to={to} className={cn("flex min-h-11 flex-col items-center justify-center gap-1 text-[10px] font-medium text-slate-500", active && "text-emerald-300")}><Icon size={19} />{label}</Link>;
}

export function clearUserState() {
  sessionStorage.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("wealthboard-") && key !== THEME_STORAGE_KEY)
      localStorage.removeItem(key);
  }
  if ("caches" in window)
    void caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("wealthboard-"))
            .map((key) => caches.delete(key)),
        ),
      );
}
