"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  CalendarClock,
  GitPullRequest,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Server,
  Settings,
  ShieldAlert,
  Siren,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/context/theme-context";
import { fetchList } from "@/lib/client/api";
import { cn } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/assets", label: "Infrastructure Assets", icon: Server },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/security", label: "Security Findings", icon: ShieldAlert },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/maintenance", label: "Maintenance", icon: CalendarClock },
  { href: "/changes", label: "Change Management", icon: GitPullRequest },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/users", label: "User Management", icon: Users, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetchList<unknown>("/notifications", { pageSize: 1 })
        .then((res) => {
          if (active) setUnread(Number(res.meta.unreadCount ?? 0));
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  const items = NAV.filter((item) => !item.adminOnly || user?.role === "admin");

  const navList = (onNavigate?: () => void) => (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sky-600/15 text-sky-500" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.href === "/notifications" && unread > 0 ? (
              <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex h-14 items-center gap-2 border-b border-line px-4">
      <span className="grid size-7 place-items-center rounded-md bg-sky-600 text-white" aria-hidden="true">
        <Activity className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight text-fg">InfraPilot</span>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface lg:flex">
        {brand}
        {navList()}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-surface">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="rounded-md p-2 text-muted hover:bg-surface-2">
                <X className="size-5" />
              </button>
            </div>
            {navList(() => setMobileOpen(false))}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Link href="/notifications" aria-label={`Notifications, ${unread} unread`} className="relative rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg">
            <Bell className="size-4" />
            {unread > 0 ? <span className="absolute right-1 top-1 size-2 rounded-full bg-rose-500" aria-hidden="true" /> : null}
          </Link>
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-fg">{user?.name}</p>
            <p className="text-xs capitalize leading-tight text-muted">{user?.role}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </header>
        <main id="main" className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
