import { test, expect } from "@playwright/test";

const supabaseConfigured = Boolean(
  process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY,
);
const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;

test.describe("ShipSync smoke", () => {
  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("ShipSync", { exact: true }).first()).toBeVisible();

    if (supabaseConfigured) {
      await expect(page.getByRole("heading", { name: "Sign in to ShipSync" })).toBeVisible();
      await expect(page.getByLabel("Email address")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Forgot password?" })).toBeVisible();
    } else {
      await expect(page.getByText(/Supabase is not configured/i)).toBeVisible();
    }
  });

  test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
    test.skip(!supabaseConfigured, "Requires VITE_SUPABASE_* in .env.local");

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in to ShipSync" })).toBeVisible();
  });

  test("password sign-in reaches dashboard", async ({ page }) => {
    test.skip(!e2eEmail || !e2ePassword, "Set E2E_EMAIL and E2E_PASSWORD in .env.local");

    await page.goto("/login");
    await page.getByLabel("Email address").fill(e2eEmail!);
    await page.getByLabel("Password").fill(e2ePassword!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("ShipSync", { exact: true }).first()).toBeVisible();
  });
});
