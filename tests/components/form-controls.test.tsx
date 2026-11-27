// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field, Input, PasswordInput, PasswordRequirements, Select, SortHeader, Switch } from "@/components/ui";

afterEach(() => cleanup());

describe("Field", () => {
  it("associates the label, hint and error with the control", () => {
    render(
      <Field label="Hostname" htmlFor="host" hint="Letters and dashes" error="/bad host/" required>
        <Input id="host" />
      </Field>,
    );

    const control = screen.getByLabelText("Hostname *");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-required", "true");
    const describedBy = control.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("host-hint");
    expect(describedBy).toContain("host-error");
    expect(document.getElementById("host-error")).toHaveAttribute("role", "alert");
    expect(document.getElementById("host-hint")).toHaveTextContent("Letters and dashes");
  });

  it("drops aria-invalid and points only at the hint when the field is valid", () => {
    render(
      <Field label="Environment" htmlFor="env" hint="Production or not">
        <Input id="env" />
      </Field>,
    );

    const control = screen.getByLabelText("Environment");
    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control.getAttribute("aria-describedby")).toBe("env-hint");
  });

  it("wires selects and textareas through the same context", () => {
    render(
      <Field label="Region" htmlFor="region" hint="Where the asset lives">
        <Select id="region" aria-label="Region select">
          <option value="eu">EU</option>
        </Select>
      </Field>,
    );
    expect(screen.getByRole("combobox", { name: "Region select" })).toHaveAttribute("aria-describedby", "region-hint");
  });
});

describe("Switch", () => {
  it("exposes switch semantics and reflects checked state", async () => {
    const user = userEvent.setup();
    render(<Switch id="auto" label="Open incidents automatically" description="Critical alerts only" />);

    const control = screen.getByRole("switch", { name: "Open incidents automatically" });
    expect(control).not.toBeChecked();
    expect(screen.getByText("Critical alerts only")).toBeInTheDocument();

    await user.click(control);
    expect(control).toBeChecked();

    await user.keyboard(" ");
    expect(control).not.toBeChecked();
  });
});

describe("SortHeader", () => {
  it("announces the active sort and toggles through the button", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortHeader column="name" activeColumn="name" direction="desc" onSort={onSort}>
              Name
            </SortHeader>
          </tr>
        </thead>
      </table>,
    );

    const header = screen.getByRole("columnheader");
    expect(header).toHaveAttribute("aria-sort", "descending");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("marks inactive columns as not sorted", () => {
    render(
      <table>
        <thead>
          <tr>
            <SortHeader column="status" activeColumn="name" direction="asc" onSort={() => undefined}>
              Status
            </SortHeader>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
  });
});

describe("PasswordInput", () => {
  it("starts masked and toggles visibility without losing the value", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="New password" defaultValue="Correct-Horse-9" />);

    const input = screen.getByLabelText("New password");
    expect(input).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: "Show characters" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("Correct-Horse-9");

    await user.click(screen.getByRole("button", { name: "Hide characters" }));
    expect(input).toHaveAttribute("type", "password");
  });
});

describe("Password field labelling", () => {
  it("stays unique so label-based queries cannot hit the visibility toggle", () => {
    render(
      <Field label="Password" htmlFor="pw" required>
        <PasswordInput id="pw" />
      </Field>,
    );

    // Regression guard: the toggle must not carry a name containing "password", otherwise
    // `getByLabel("Password")` becomes ambiguous in Playwright strict mode.
    expect(screen.getAllByLabelText(/password/i)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Show characters" })).toBeInTheDocument();
  });
});

describe("PasswordRequirements", () => {
  it("states each rule in text, not colour alone", () => {
    render(<PasswordRequirements value="lowercase" />);
    expect(screen.getByText("At least 12 characters")).toBeInTheDocument();
    expect(screen.getByText("An uppercase letter")).toBeInTheDocument();
    // Met/unmet is also announced in text for assistive technology.
    expect(screen.getAllByText("(met)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("(not met)").length).toBeGreaterThan(0);
  });
});
