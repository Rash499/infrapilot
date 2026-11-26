// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "admin" as string,
  useAsync: vi.fn(() => ({ data: undefined, loading: true, error: null, reload: vi.fn() })),
}));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Ada Admin", email: "ada@example.com", role: mocks.role },
    can: () => true,
  }),
}));
vi.mock("@/context/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/client/use-async", () => ({ useAsync: mocks.useAsync }));
vi.mock("@/lib/client/api", () => ({
  fetchData: vi.fn(() => Promise.resolve(null)),
  fetchList: vi.fn(() => Promise.resolve({ items: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 1 } })),
  sendData: vi.fn(() => Promise.resolve(null)),
  getErrorMessage: (error: unknown) => String(error),
}));

import UsersPage from "@/app/(app)/users/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.role = "admin";
});

describe("Users and access tabs", () => {
  it("exposes the views as a tablist so the audit log is reachable by role", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    const tablist = screen.getByRole("tablist", { name: "User management views" });
    expect(tablist).toBeInTheDocument();

    const auditTab = screen.getByRole("tab", { name: "Audit log", exact: true });
    expect(screen.getByRole("tab", { name: "Users & roles" })).toHaveAttribute("aria-selected", "true");
    expect(auditTab).toHaveAttribute("aria-selected", "false");

    await user.click(auditTab);

    expect(screen.getByRole("tab", { name: "Audit log", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-audit");
    expect(screen.getByLabelText("Search audit log")).toBeInTheDocument();
    // The tab bar must not masquerade as plain buttons; keyboard users get the tab pattern.
    expect(screen.queryByRole("button", { name: "Audit log", exact: true })).not.toBeInTheDocument();
  });

  it("only renders user administration for administrators", () => {
    mocks.role = "viewer";
    render(<UsersPage />);

    expect(screen.getByText("Administrator access required")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
