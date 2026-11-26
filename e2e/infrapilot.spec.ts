import { expect, test } from "@playwright/test";

const email = process.env.E2E_ADMIN_EMAIL ?? "admin@infrapilot.local";
const password = process.env.E2E_ADMIN_PASSWORD ?? "";
const stamp = Date.now();

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
}

test.describe("InfraPilot end-to-end", () => {
  test.skip(!password, "Set E2E_ADMIN_PASSWORD (seeded administrator) to run the end-to-end suite.");

  test("rejects invalid credentials without revealing which field is wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("Wrong-Password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });

  test("shows account sign-in history to administrators", async ({ page }) => {
    await signIn(page);
    await page.goto("/users");
    const accountRow = page.getByRole("row").filter({ hasText: email });
    await accountRow.getByRole("button", { name: /View sign-in history/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Successful sign-in");
  });

  test("filters audit records by action and summary", async ({ page }) => {
    await signIn(page);
    await page.goto("/users");
    await page.getByRole("tab", { name: "Audit log", exact: true }).click();
    await page.getByLabel("Filter audit by action").selectOption("auth.login");
    await page.getByLabel("Search audit log").fill("Signed in");
    await expect(page.getByText("Signed in").first()).toBeVisible();
  });

  test("registers an asset, configures a monitor, opens an incident and records a finding", async ({ page }) => {
    await signIn(page);

    await page.goto("/assets");
    await page.getByRole("button", { name: "Register asset" }).first().click();
    const dialog = page.getByRole("dialog");
    const assetName = `e2e-asset-${stamp}`;
    await dialog.getByLabel("Asset name *").fill(assetName);
    await dialog.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByText("Asset registered")).toBeVisible();
    await expect(page.getByRole("link", { name: assetName })).toBeVisible();

    await page.goto("/monitoring");
    await page.getByRole("button", { name: "Add check" }).first().click();
    await page.getByRole("dialog").getByLabel("Name *").fill(`e2e-check-${stamp}`);
    await page.getByRole("dialog").getByLabel("URL *").fill("https://www.iana.org/");
    await page.getByRole("dialog").getByRole("button", { name: "Create check" }).click();
    await expect(page.getByText(/Monitoring target created/)).toBeVisible();

    await page.goto("/incidents");
    await page.getByRole("button", { name: "Open incident" }).first().click();
    await page.getByRole("dialog").getByLabel("Title *").fill(`e2e incident ${stamp}`);
    await page.getByRole("dialog").getByLabel("Description *").fill("Automated end-to-end incident.");
    await page.getByRole("dialog").getByRole("button", { name: "Open incident" }).click();
    await expect(page.getByText(/INC-\d+ opened/)).toBeVisible();

    await page.goto("/security");
    await page.getByRole("button", { name: "Record finding" }).first().click();
    await page.getByRole("dialog").getByLabel("Title *").fill(`e2e finding ${stamp}`);
    await page.getByRole("dialog").getByLabel("Description *").fill("Automated end-to-end finding.");
    await page.getByRole("dialog").getByRole("button", { name: "Record finding" }).click();
    await expect(page.getByText("Finding recorded")).toBeVisible();
  });

  test("schedules maintenance and shows it in the list", async ({ page }) => {
    await signIn(page);
    await page.goto("/maintenance");
    await page.getByRole("button", { name: "Schedule maintenance" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title *").fill(`e2e maintenance ${stamp}`);
    await dialog.getByLabel("Description *").fill("Automated maintenance window.");
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Maintenance scheduled")).toBeVisible();
    await expect(page.getByText(`e2e maintenance ${stamp}`)).toBeVisible();
  });
});
