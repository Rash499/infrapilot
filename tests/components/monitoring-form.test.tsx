// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Ada Admin", role: "admin" }, can: () => true }),
}));
vi.mock("@/context/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/client/use-async", () => ({
  useAsync: () => ({ data: undefined, loading: true, error: null, reload: vi.fn() }),
}));
vi.mock("@/lib/client/api", () => ({
  fetchData: vi.fn(() => Promise.resolve(null)),
  fetchList: vi.fn(() => Promise.resolve({ items: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 1 } })),
  sendData: vi.fn(() => Promise.resolve(null)),
  validatePayload: vi.fn(),
  getErrorMessage: (error: unknown) => String(error),
}));
vi.mock("@/components/charts", () => ({
  ResponseTrendChart: () => null,
  DistributionChart: () => null,
}));

import MonitoringPage from "@/app/(app)/monitoring/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Add monitoring check dialog", () => {
  it("keeps the labels and submit action the end-to-end suite drives", async () => {
    const user = userEvent.setup();
    render(<MonitoringPage />);

    await user.click(screen.getByRole("button", { name: "Add check" }));

    const dialog = screen.getByRole("dialog", { name: "Add monitoring check" });
    // Asserted verbatim in e2e/infrapilot.spec.ts.
    expect(within(dialog).getByLabelText("Name *")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("URL *")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create check" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Target" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Schedule and thresholds" })).toBeInTheDocument();
  });
});
