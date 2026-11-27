// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/context/toast-context", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { AssetFormModal } from "@/components/forms/asset-form";

afterEach(() => cleanup());

describe("AssetFormModal", () => {
  it("keeps the labelled fields the end-to-end suite drives", () => {
    render(
      <AssetFormModal
        open
        onClose={() => undefined}
        onSaved={() => undefined}
        owners={[{ id: "u1", name: "Ada Admin", email: "ada@example.com" } as never]}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Register asset" });
    // These label texts are asserted verbatim in e2e/infrapilot.spec.ts.
    for (const label of ["Asset name *", "Asset type *", "Environment *", "Hostname", "Owner", "Status", "Description"]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }

    expect(within(dialog).getByRole("group", { name: "Identity" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Network and platform" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Ownership and state" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Register asset" })).toBeInTheDocument();
  });

  it("names the submit action after the edit flow when an asset is supplied", () => {
    render(
      <AssetFormModal
        open
        asset={
          {
            id: "a1",
            name: "prod-db-01",
            assetType: "virtual_machine",
            environment: "production",
            status: "healthy",
          } as never
        }
        onClose={() => undefined}
        onSaved={() => undefined}
        owners={[]}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Edit asset" });
    expect(within(dialog).getByLabelText("Asset name *")).toHaveValue("prod-db-01");
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("validates per field with the shared schema before calling the API", async () => {
    const user = userEvent.setup();
    render(<AssetFormModal open onClose={() => undefined} onSaved={() => undefined} owners={[]} />);

    const dialog = screen.getByRole("dialog", { name: "Register asset" });
    const name = within(dialog).getByLabelText("Asset name *");
    await user.type(name, "bad host!");
    await user.clear(name);
    await user.type(within(dialog).getByLabelText("IP address"), "999.1.1.1");
    await user.click(within(dialog).getByRole("button", { name: "Register asset" }));

    expect(await within(dialog).findByText("Required")).toBeInTheDocument();
    expect(await within(dialog).findByText("Enter a valid IPv4 or IPv6 address")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toBe(document.activeElement);
  });

  it("asks before discarding an edited asset", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AssetFormModal open onClose={onClose} onSaved={() => undefined} owners={[]} />);

    const dialog = screen.getByRole("dialog", { name: "Register asset" });
    await user.type(within(dialog).getByLabelText("Asset name *"), "prod-cache-01");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const confirm = await screen.findByRole("dialog", { name: "Discard changes?" });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalled();
  });
});
