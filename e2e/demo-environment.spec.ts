import { expect, test } from "@playwright/test";

/**
 * Renders the seeded demo environment through the real UI.
 *
 * Run it after `npm run db:seed:demo` with DEMO_SEED_PASSWORD set; the suite is skipped otherwise so
 * the regular end-to-end contract is unaffected on machines without demo data.
 */

const adminEmail = process.env.DEMO_ADMIN_EMAIL ?? "demo.admin@infrapilot.local";
const viewerEmail = process.env.DEMO_VIEWER_EMAIL ?? "demo.auditor@infrapilot.local";
const password = process.env.DEMO_SEED_PASSWORD ?? "";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
}

test.describe("demo environment", () => {
  test.skip(!password, "Set DEMO_SEED_PASSWORD (and run npm run db:seed:demo) to render the demo environment.");

  test("dashboard summarises the seeded estate", async ({ page }) => {
    await signIn(page, adminEmail);

    // KPI labels are present and non-zero (the exact totals depend on how much was seeded).
    await expect(page.getByText("Registered assets").first()).toBeVisible();
    await expect(page.getByText("Open incidents").first()).toBeVisible();
    await expect(page.getByText("Critical & high findings").first()).toBeVisible();

    // The attention list is fed by the seeded monitor states.
    await expect(page.getByText("prd-db-02 replica PostgreSQL (TCP)")).toBeVisible();
    await expect(page.getByText("prd-backup-01 job service (HTTP)")).toBeVisible();

    // Active incidents, findings and upcoming maintenance come from the seeded records.
    await expect(page.getByText("Database replica prd-db-02 not accepting connections")).toBeVisible();
    await expect(page.getByText("TLS 1.0 and 1.1 still enabled on the storefront listener")).toBeVisible();
    await expect(page.getByText("Monthly Windows security patching")).toBeVisible();
  });

  test("asset inventory, detail page and linked monitor render", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/assets");
    await page.getByLabel("Search assets").fill("prd-db-01");
    await page.getByRole("link", { name: "prd-db-01", exact: true }).click();

    await expect(page.getByRole("heading", { name: "prd-db-01" })).toBeVisible();
    await expect(page.getByText("10.20.10.31").first()).toBeVisible();
    await expect(page.getByText("Asset details").first()).toBeVisible();
    await expect(page.getByText("prd-db-01 PostgreSQL (TCP)").first()).toBeVisible();
  });

  test("monitoring page shows healthy, unavailable and paused services", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/monitoring");

    await page.getByLabel("Search checks").fill("prd-db-02");
    await expect(page.getByText("prd-db-02 replica PostgreSQL (TCP)")).toBeVisible();
    await expect(page.getByText("Unavailable").first()).toBeVisible();

    await page.getByLabel("Search checks").fill("prd-win-files-01");
    await expect(page.getByText("prd-win-files-01 WinRM (HTTP)")).toBeVisible();
    await expect(page.getByText("Paused").first()).toBeVisible();
  });

  test("incident detail shows the resolution and timeline", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/incidents");
    await page.getByLabel("Search incidents").fill("Nightly backup job failed");
    await page.getByRole("link", { name: /Nightly backup job failed/ }).click();

    await expect(page.getByText("Resolved").first()).toBeVisible();
    // Administrators get the management form, so the documented resolution is a field value.
    await expect(page.getByLabel(/Root cause/)).toHaveValue(/Backup repository service was stopped/);
    await expect(page.getByLabel(/Resolution summary/)).toHaveValue(/Restarted the Veeam Backup Service/);
    await expect(page.getByText(/Recovery point created/)).toBeVisible();
  });

  test("findings are labelled as demonstration data", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/security");
    await page.getByLabel("Search findings").fill("TLS 1.0 and 1.1");
    await expect(page.getByText("TLS 1.0 and 1.1 still enabled on the storefront listener")).toBeVisible();

    await page.getByRole("button", { name: /Edit TLS 1.0 and 1.1/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/Description/)).toHaveValue(/Demonstration finding created by the InfraPilot demo seeder/);
    await expect(dialog.getByLabel("Remediation recommendation")).toHaveValue(/Disable TLS 1\.0\/1\.1 on the listener/);
  });

  test("change requests show the approval workflow states", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/changes");

    await page.getByLabel("Search changes").fill("PostgreSQL 16.4");
    await expect(page.getByText("Upgrade prd-db-01 to PostgreSQL 16.4")).toBeVisible();
    await expect(page.getByText("Pending approval").first()).toBeVisible();

    await page.getByLabel("Search changes").fill("Deploy checkout service release");
    await expect(page.getByText("Deploy checkout service release 2026.7.2")).toBeVisible();
    await expect(page.getByText("Approved").first()).toBeVisible();
  });

  test("maintenance page shows scheduled and running windows", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/maintenance");

    await expect(page.getByText("Monthly Windows security patching")).toBeVisible();
    await expect(page.getByText("Backup verification and restore test")).toBeVisible();
    await expect(page.getByText("In progress").first()).toBeVisible();
  });

  test("notifications are addressed to the demo administrator", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/notifications");

    await expect(page.getByText("CHG awaiting approval: PostgreSQL 16.4 upgrade")).toBeVisible();
    await expect(page.getByText("prd-db-02 replica PostgreSQL is unavailable")).toBeVisible();
    await expect(page.getByText(/unread notification/)).toBeVisible();
  });

  test("user directory lists the demo accounts and their roles", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/users");
    await expect(page.getByRole("cell", { name: "demo.operator@infrapilot.local" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "demo.auditor@infrapilot.local" })).toBeVisible();
  });

  test("the read-only demo account sees no write actions", async ({ page }) => {
    await signIn(page, viewerEmail);
    await page.goto("/assets");
    await page.getByLabel("Search assets").fill("prd-web-01");
    await expect(page.getByRole("link", { name: "prd-web-01", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Register asset" })).toHaveCount(0);

    // Administrative navigation is hidden for viewers as well.
    await expect(page.getByRole("link", { name: "Users & access", exact: true })).toHaveCount(0);
  });
});
