// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  get: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/lib/client/api", () => ({
  api: { get: state.get },
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "Something went wrong"),
}));

import { GlobalSearch } from "@/components/global-search";

const results = {
  q: "prd",
  totalHits: 2,
  groups: [
    {
      key: "assets",
      label: "Assets",
      total: 2,
      items: [
        { id: "a1", title: "prd-db-01", subtitle: "Virtual machine · Production", href: "/assets/a1", meta: "10.0.0.5" },
        { id: "a2", title: "prd-web-01", subtitle: "Virtual machine · Production", href: "/assets/a2", meta: null },
      ],
    },
  ],
};

beforeEach(() => {
  state.push.mockReset();
  state.get.mockReset();
  state.get.mockResolvedValue({ data: { data: results } });
});

afterEach(() => cleanup());

describe("GlobalSearch", () => {
  it("waits for two characters before querying and groups the results", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    const input = screen.getByRole("combobox", { name: "Global search" });
    await user.type(input, "p");
    expect(state.get).not.toHaveBeenCalled();

    await user.type(input, "rd");
    await waitFor(() => expect(state.get).toHaveBeenCalledWith("/search", expect.objectContaining({ params: { q: "prd", limit: 4 } })));

    expect(await screen.findByText("prd-db-01")).toBeInTheDocument();
    expect(screen.getByText("Assets")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("listbox", { name: "Search results" })).toBeInTheDocument();
  });

  it("moves through results with the arrow keys and opens the active hit", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    const input = screen.getByRole("combobox", { name: "Global search" });
    await user.type(input, "prd");
    await screen.findByText("prd-db-01");

    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(state.push).toHaveBeenCalledWith("/assets/a2");
  });

  it("falls back to the full search page when nothing is highlighted", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    await user.type(screen.getByRole("combobox", { name: "Global search" }), "prd");
    await screen.findByText("prd-db-01");

    await user.keyboard("{Enter}");
    expect(state.push).toHaveBeenCalledWith("/search?q=prd");
  });

  it("shows an empty state, then clears with Escape", async () => {
    state.get.mockResolvedValue({ data: { data: { q: "zz", totalHits: 0, groups: [] } } });
    const user = userEvent.setup();
    render(<GlobalSearch />);

    const input = screen.getByRole("combobox", { name: "Global search" });
    await user.type(input, "zz");
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.queryByText(/No matches for/)).not.toBeInTheDocument();
  });

  it("surfaces a failed search instead of pretending there are no matches", async () => {
    state.get.mockRejectedValue(new Error("Unable to reach the server."));
    const user = userEvent.setup();
    render(<GlobalSearch />);

    await user.type(screen.getByRole("combobox", { name: "Global search" }), "prd");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
  });
});
