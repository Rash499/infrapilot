// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivityTimeline,
  Alert,
  CardHeader,
  DetailItem,
  DetailList,
  EmptyState,
  ErrorState,
  Segmented,
  StatusBadge,
  StatusDot,
} from "@/components/ui";

afterEach(() => cleanup());

describe("Segmented", () => {
  it("exposes the selected option and reports changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        label="Incident scope"
        value="all"
        onChange={onChange}
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Incident scope" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(onChange).toHaveBeenCalledWith("active");
  });
});

describe("Status semantics", () => {
  it("humanises machine status values", () => {
    render(
      <>
        <StatusBadge value="pending_approval" />
        <StatusBadge value="accepted_risk" />
      </>,
    );
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByText("Accepted risk")).toBeInTheDocument();
  });

  it("renders a status dot with a tone class", () => {
    const { container } = render(<StatusDot value="unavailable" />);
    expect(container.querySelector(".dot-danger")).toBeInTheDocument();
  });
});

describe("Alert", () => {
  it("uses an assertive role for errors and a polite one otherwise", () => {
    const { rerender } = render(<Alert tone="danger">Import failed</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Import failed");

    rerender(<Alert tone="success">Saved</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("Layout primitives", () => {
  it("renders card headers, detail pairs and timelines with accessible structure", () => {
    render(
      <>
        <CardHeader title="Response time" description="Last 24 hours" />
        <DetailList>
          <DetailItem label="Hostname">prod-db-01</DetailItem>
          <DetailItem label="Environment">Production</DetailItem>
        </DetailList>
        <ActivityTimeline
          items={[
            { id: "1", title: "Asset created", meta: "2 hours ago", tone: "info" },
            { id: "2", title: "Owner changed", meta: "1 hour ago" },
          ]}
        />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Response time" })).toBeInTheDocument();
    expect(screen.getByText("Last 24 hours")).toBeInTheDocument();
    expect(screen.getByText("Hostname")).toBeInTheDocument();
    expect(screen.getByText("prod-db-01")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Empty and error states", () => {
  it("renders an empty state with an action and an error state with retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <>
        <EmptyState title="No assets yet" description="Register the first asset." action={<button type="button">Add asset</button>} />
        <ErrorState message="Network unreachable" onRetry={onRetry} />
      </>,
    );

    expect(screen.getByText("No assets yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add asset" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
