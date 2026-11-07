import { expect, test } from "@playwright/test";

test("the landing page explains the product and offers import", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Understand Any Codebase. Visually." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Import repository" })).toBeVisible();
});

test("an invalid URL shows a clear error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("GitHub repository URL").fill("https://evil.example/a/b");
  await page.getByRole("button", { name: "Import repository" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "github.com" })).toBeVisible();
});

test("a signed-out visitor is sent from the dashboard to login", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to RepoScope" })).toBeVisible();
});

test("an unknown repository shows the not-found page", async ({ page }) => {
  await page.goto("/repositories/00000000-0000-4000-8000-000000000000/overview");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("the landing page has no sideways scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("signed in", () => {
  test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to a confirmed test account.");

  test("login reaches the dashboard, and sign out ends the session", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a wrong password is refused", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  });
});

test.describe("live analysis", () => {
  test.skip(!process.env.E2E_LIVE, "Set E2E_LIVE=1 to import a real repository.");

  test("import shows real progress, then real results", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.getByLabel("GitHub repository URL").fill(process.env.E2E_REPO ?? "");
    await page.getByRole("button", { name: "Import repository" }).click();

    await expect(page).toHaveURL(/overview/);
    await expect(page.getByText("Internal dependencies")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Languages" })).toBeVisible();
    await expect(page.getByText("Not analyzed yet")).toHaveCount(0);
  });
});
