"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  BellRing,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Server,
  Settings,
  ShieldAlert,
  Siren,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/context/theme-context";
import { fetchList } from "@/lib/client/api";
import { cn, IconButton, StatusDot } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/assets", label: "Assets", icon: Server },
      { href: "/monitoring", label: "Monitoring", icon: Activity },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/alerts", label: "Alerts", icon: BellRing },
      { href: "/incidents", label: "Incidents", icon: Siren },
      { href: "/maintenance", label: "Maintenance", icon: CalendarClock },
      { href: "/changes", label: "Change management", icon: GitPullRequest },
    ],
  },
  {
    label: "Security",
    items: [{ href: "/security", label: "Security findings", icon: ShieldAlert }],
  },
  {
    label: "Administration",
    items: [{ href: "/users", label: "Users & access", icon: Users, adminOnly: true }],
  },
];

const UTILITY_ITEMS: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

const DETAIL_LABELS: Record<string, { group: string; parent: string; parentHref: string }> = {
  assets: { group: "Infrastructure", parent: "Assets", parentHref: "/assets" },
  incidents: { group: "Operations", parent: "Incidents", parentHref: "/incidents" },
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name?: string | null): string {
  if (!name) return "IP";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "IP";
}

const SIDEBAR_STORAGE_KEY = "infrapilot-sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [search, setSearch] = useState("");
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // The shell only mounts after the session resolves, so reading storage here cannot
  // produce a hydration mismatch.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    } catch {
      /* storage unavailable — keep the expanded default */
    }
  }, []);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
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

  // Mobile drawer: lock scroll and support Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  // User menu: close on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || user?.role === "admin"),
  })).filter((group) => group.items.length > 0);

  const breadcrumbs = (() => {
    const allItems = [...groups.flatMap((group) => group.items), ...UTILITY_ITEMS];
    const current = allItems.find((item) => isActive(pathname, item.href));
    const segments = pathname.split("/").filter(Boolean);
    if (current && segments.length > 1) {
      const detail = DETAIL_LABELS[segments[0]!];
      if (detail) {
        return [
          { label: detail.group },
          { label: detail.parent, href: detail.parentHref },
          { label: segments[0] === "assets" ? "Asset detail" : "Incident detail" },
        ];
      }
      return [{ label: current.label, href: current.href }, { label: "Details" }];
    }
    if (current) return [{ label: current.label }];
    return [{ label: "InfraPilot" }];
  })();

  const navLink = (item: NavItem, options: { onNavigate?: () => void; collapsedRail?: boolean }) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    const showBadge = item.href === "/notifications" && unread > 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={options.onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={options.collapsedRail ? item.label : undefined}
        title={options.collapsedRail ? item.label : undefined}
        className={cn(
          "nav-item group",
          active && "nav-item-active",
          options.collapsedRail && "justify-center px-0",
        )}
      >
        <span className="relative grid shrink-0 place-items-center">
          <Icon className={cn("size-4", active ? "text-accent" : "text-current")} aria-hidden="true" />
          {showBadge && options.collapsedRail ? (
            <span className="absolute -right-1.5 -top-1.5 size-2 rounded-full bg-rose-500" aria-hidden="true" />
          ) : null}
        </span>
        {!options.collapsedRail ? (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {showBadge ? (
              <span className="rounded-full bg-rose-500/90 px-1.5 text-2xs font-semibold leading-4 text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </>
        ) : null}
      </Link>
    );
  };

  const navBody = (options: { collapsedRail?: boolean; onNavigate?: () => void }) => (
    <div className={cn("flex-1 overflow-y-auto py-3", options.collapsedRail ? "px-2" : "px-2.5")}>
      {groups.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          {options.collapsedRail ? (
            <div className="mx-auto mb-2 h-px w-6 bg-sidebar-line" aria-hidden="true" />
          ) : (
            <p className="nav-group-label mb-1.5">{group.label}</p>
          )}
          <div className="space-y-0.5">{group.items.map((item) => navLink(item, options))}</div>
        </div>
      ))}
      <div className={cn("mt-2 border-t border-sidebar-line pt-3", options.collapsedRail ? "px-0" : "")}>
        {!options.collapsedRail ? <p className="nav-group-label mb-1.5">Workspace</p> : null}
        <div className="space-y-0.5">{UTILITY_ITEMS.map((item) => navLink(item, options))}</div>
      </div>
    </div>
  );

  const brand = (collapsedRail: boolean) => (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-line",
        collapsedRail ? "justify-center px-2" : "px-3.5",
      )}
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-[linear-gradient(145deg,var(--accent),#1e40af)] text-white shadow-sm"
        aria-hidden="true"
      >
        <Activity className="size-[18px]" strokeWidth={2.4} />
      </span>
      {!collapsedRail ? (
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-sidebar-fg">
            InfraPilot
          </span>
          <span className="block truncate text-2xs font-medium uppercase tracking-[0.12em] text-sidebar-muted">
            Infrastructure ops
          </span>
        </span>
      ) : null}
    </div>
  );

  const sidebarFooter = (
    <div className={cn("shrink-0 border-t border-sidebar-line p-2", collapsed && "flex justify-center")}>
      <button
        type="button"
        onClick={() => setCollapsedPersisted(!collapsed)}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
        className={cn(
          "nav-item w-full",
          collapsed ? "justify-center px-0" : "justify-start",
        )}
      >
        {collapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
        {!collapsed ? <span className="text-xs">Collapse</span> : null}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside
        aria-label="Sidebar"
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-line bg-sidebar lg:flex",
          collapsed ? "w-[68px]" : "w-[248px]",
        )}
      >
        {brand(collapsed)}
        {navBody({ collapsedRail: collapsed })}
        {sidebarFooter}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="animate-overlay-in absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="animate-dialog-in relative flex h-full w-[280px] max-w-[85vw] flex-col border-r border-sidebar-line bg-sidebar shadow-overlay"
          >
            <div className="flex items-center justify-between border-b border-sidebar-line pr-2">
              {brand(false)}
              <IconButton
                label="Close navigation"
                icon={X}
                onClick={() => setMobileOpen(false)}
                className="text-sidebar-muted hover:bg-sidebar-2 hover:text-sidebar-fg"
              />
            </div>
            {navBody({ onNavigate: () => setMobileOpen(false) })}
            <div className="shrink-0 border-t border-sidebar-line p-3">
              <p className="truncate text-xs font-medium text-sidebar-fg">{user?.name}</p>
              <p className="truncate text-2xs capitalize text-sidebar-muted">{user?.role}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md md:px-5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>

          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 text-xs">
              {breadcrumbs.map((crumb, index) => {
                const last = index === breadcrumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" /> : null}
                    {crumb.href && !last ? (
                      <Link href={crumb.href} className="truncate rounded text-muted transition-colors hover:text-fg">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "font-medium text-fg" : "text-muted")}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <form
            role="search"
            className="relative hidden shrink-0 md:block"
            onSubmit={(event) => {
              event.preventDefault();
              const term = search.trim();
              if (term.length >= 2) router.push(`/search?q=${encodeURIComponent(term)}`);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search assets, alerts, incidents and more"
              placeholder="Search…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 w-44 rounded-md border border-line bg-surface-2/60 pl-8 pr-2 text-xs text-fg placeholder:text-muted focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring lg:w-60"
            />
          </form>

          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              title="Notifications"
              className="relative grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              <Bell className="size-[18px]" aria-hidden="true" />
              {unread > 0 ? (
                <span className="absolute right-1 top-1 grid min-w-3.5 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold leading-3.5 text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>

            <button
              type="button"
              onClick={toggle}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              {theme === "dark" ? <Sun className="size-[18px]" aria-hidden="true" /> : <Moon className="size-[18px]" aria-hidden="true" />}
            </button>

            <div className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

            <div ref={menuRef} className="relative">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                className={cn(
                  "flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring",
                  menuOpen && "bg-surface-2",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-2xs font-semibold text-accent ring-1 ring-inset ring-accent/20">
                  {initials(user?.name)}
                </span>
                <span className="hidden min-w-0 text-left md:block">
                  <span className="block max-w-[150px] truncate text-xs font-medium leading-tight text-fg">{user?.name}</span>
                  <span className="block text-2xs capitalize leading-tight text-muted">{user?.role}</span>
                </span>
                <ChevronDown className={cn("size-3.5 shrink-0 text-muted transition-transform", menuOpen && "rotate-180")} aria-hidden="true" />
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  aria-label="Account"
                  className="animate-dialog-in absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-overlay"
                >
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-fg">{user?.name}</p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-2xs capitalize text-muted">
                      <StatusDot value={user?.role === "admin" ? "admin" : user?.role === "operator" ? "operator" : "viewer"} />
                      {user?.role} access
                    </p>
                  </div>
                  <div className="p-1">
                    <Link
                      href="/settings"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                    >
                      <Settings className="size-4 text-muted" aria-hidden="true" />
                      Settings
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut()}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                    >
                      <LogOut className="size-4 text-muted" aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
