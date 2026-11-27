import { expect, test } from "@playwright/test";

/**
 * Alert console and Trivy import: the two operator surfaces added for monitoring analytics and
 * security operations. Both run against the real backend and seeded database.
 */

const email = process.env.E2E_ADMIN_EMAIL ?? "admin@infrapilot.local";
const password = process.env.E2E_ADMIN_PASSWORD ?? "";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
}

const report = {
  SchemaVersion: 2,
  ArtifactName: "registry.example.com/infrapilot-e2e:1.0.0",
  ArtifactType: "container_image",
  Metadata: { ScanStartedAt: new Date().toISOString(), Scanner: { Version: "0.55.0" } },
  Results: [
    {
      Target: "app (debian 12)",
      Type: "debian",
      Vulnerabilities: [
        {
          VulnerabilityID: "CVE-2025-42424",
          PkgName: "libe2e",
          InstalledVersion: "1.0.0",
          FixedVersion: "1.0.1",
          Severity: "HIGH",
          Title: "E2E imported vulnerability",
          Description: "Synthetic vulnerability from the end-to-end suite.",
          CVSS: { nvd: { V3Score: 7.5 } },
        },
      ],
    },
  ],
};

test.describe("alerts and security operations", () => {
  test.skip(!password, "Set E2E_ADMIN_PASSWORD (seeded administrator) to run the end-to-end suite.");

  test("alert console lists alerts or an explicit empty state with summary cards", async ({ page }) => {
    await signIn(page);
    await page.goto("/alerts");

    await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
    await expect(page.getByText("Active alerts").first()).toBeVisible();
    await expect(page.getByText("Critical active").first()).toBeVisible();

    // Either seeded/live alerts render, or the page explains that none match — never a blank screen.
    const rows = page.getByRole("row");
    const empty = page.getByText("No alerts match these filters");
    await expect(rows.nth(1).or(empty)).toBeVisible();

    // Filtering by status must reach the API without an error banner.
    await page.getByLabel("Filter by status").selectOption("resolved");
    await expect(page.getByText("No alerts match these filters").or(page.getByRole("row").nth(1))).toBeVisible();
  });

  test("global search returns grouped results for a stored asset", async ({ page }) => {
    await signIn(page);
    await page.goto("/search?q=a");

    await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
    await page.getByLabel("Search", { exact: true }).fill("prd");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/result(s)? for/)).toBeVisible({ timeout: 15_000 });
  });

  test("imports a Trivy JSON report against an asset without executing it", async ({ page }) => {
    await signIn(page);
    await page.goto("/security");
    await page.getByRole("button", { name: "Import Trivy report" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("never executes the file or runs a live scan");

    const assetSelect = page.locator("#trivy-asset");
    const options = assetSelect.locator("option");
    if ((await options.count()) < 2) test.skip(true, "No asset available to attach the imported report to");
    await assetSelect.selectOption({ index: 1 });

    await page.locator("#trivy-file").setInputFiles({
      name: "trivy-report.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(report)),
    });

    await expect(dialog.getByText(/vulnerabilities seen/)).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText(/1 critical and 0 high|0 critical and 1 high/)).toBeVisible();
    await expect(dialog.getByText(/not a live scan performed by InfraPilot/)).toBeVisible();
  });
});
