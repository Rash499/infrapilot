// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});
import { ConfirmDialog, Field, Input, Modal, StatusBadge } from "@/components/ui";
import { validatePayload } from "@/lib/client/api";
import { assetCreateSchema } from "@/validators/schemas";

describe("Modal", () => {
  it("renders an accessible dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Register asset" description="Inventory entry">
        <p>Body content</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Register asset" })).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => undefined} title="Hidden">
        <p>Secret</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("invokes onConfirm only when the confirm button is pressed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Archive asset?" description="History is kept." confirmLabel="Archive" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("Field and form controls", () => {
  it("associates labels with inputs and surfaces validation errors", () => {
    render(
      <Field label="Hostname" htmlFor="host" error="Hostname contains invalid characters">
        <Input id="host" />
      </Field>,
    );
    expect(screen.getByLabelText("Hostname")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Hostname contains invalid characters");
  });
});

describe("status presentation", () => {
  it("humanises status values for display", () => {
    render(<StatusBadge value="pending_approval" />);
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
  });
});

describe("client-side payload validation", () => {
  it("uses the shared API schema and reports the failing field", () => {
    expect(() => validatePayload(assetCreateSchema, { name: "", assetType: "other" })).toThrow(/name/);
  });

  it("accepts a valid payload without throwing", () => {
    expect(() => validatePayload(assetCreateSchema, { name: "edge-router", assetType: "network_device" })).not.toThrow();
  });
});
