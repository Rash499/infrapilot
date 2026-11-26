// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
});
