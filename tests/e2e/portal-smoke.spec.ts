
import { test, expect } from "@playwright/test";
import { chromium } from "playwright";

function baseUrl(): string {
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

test.describe.serial("portal smoke (demo)", () => {
  let browser: ReturnType<typeof chromium.launch>;
  let page: Page;

  test.beforeAll(async () => {
    browser = await chromium.launch();
  });

  test.beforeEach(async () => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test("rejects invalid credentials with a visible message", async () => {
    await page.goto(`${baseUrl()}/login`);
    await page.getByLabel(/email/i).fill("admin@sunrise.demo");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(
      page.getByRole("alert")
        .or(page.getByText(/incorrect/i))
        .or(page.getByText(/login failed/i),
          { exact: false }),
    ).toBeVisible({ timeout: 6_000 });
  });

  test("signs in as an institution admin and shows the synthetic-data banner", async () => {
    await page.goto(`${baseUrl()}/login`);
    await page.getByLabel(/email/i).fill("admin@sunrise.demo");
    await page.getByLabel(/password/i).fill("Demo@1234");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/portal/, { timeout: 10_000 }).catch(() => undefined);
    await expect(
      page.getByText(/synthetic demo/i)
        .or(page.getByTestId(/synthetic-banner/i),
          { exact: false }),
    ).toBeVisible({ timeout: 6_000 });
  });
});
