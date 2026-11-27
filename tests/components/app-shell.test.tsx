// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/",
  user: { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "admin" as string | null },
  unreadCount: 0,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: state.user, signOut: vi.fn() }),
}));
vi.mock("@/context/theme-context", () => ({
  useTheme: () => ({ theme: "dark", toggle: vi.fn(), setTheme: vi.fn() }),
}));
vi.mock("@/lib/client/api", () => ({
  fetchList: vi.fn(() =>
    Promise.resolve({
      items: [],
      meta: { page: 1, pageSize: 1, total: 0, totalPages: 0, unreadCount: state.unreadCount },
    }),
  ),
}));

import { AppShell } from "@/components/app-shell";

beforeEach(() => {
  window.localStorage.clear();
  state.pathname = "/";
  state.user = { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "admin" };
  state.unreadCount = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppShell navigation", () => {
  it("renders the grouped sidebar with only routes that exist", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(sidebar).toBeInTheDocument();

    for (const group of ["Overview", "Infrastructure", "Operations", "Security", "Administration"]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    for (const label of ["Dashboard", "Assets", "Monitoring", "Alerts", "Incidents", "Maintenance", "Change management", "Security findings"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    // No route exists for a "Services" section, so it must not be advertised.
    expect(screen.queryByRole("link", { name: "Services" })).not.toBeInTheDocument();
  });

  it("marks the active route and hides admin-only navigation from viewers", () => {
    state.pathname = "/monitoring";
    state.user = { id: "u2", name: "Vic Viewer", email: "vic@example.com", role: "viewer" };
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Monitoring" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Assets" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Users & access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });

  it("shows breadcrumbs for a detail route", () => {
    state.pathname = "/assets/abc123";
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("Infrastructure");
    expect(breadcrumb).toHaveTextContent("Assets");
    expect(breadcrumb).toHaveTextContent("Asset detail");
    expect(within(breadcrumb).getByRole("link", { name: "Assets" })).toHaveAttribute("href", "/assets");
  });

  it("persists the collapsed sidebar state", async () => {
    const user = userEvent.setup();
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(window.localStorage.getItem("infrapilot-sidebar-collapsed")).toBe("true");
    // The rail keeps every destination reachable through its accessible name.
    expect(screen.getByRole("link", { name: "Incidents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
  });

  it("surfaces the unread notification count from the API meta", async () => {
    state.unreadCount = 4;
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Notifications, 4 unread" })).toBeInTheDocument();
    });
  });
});
