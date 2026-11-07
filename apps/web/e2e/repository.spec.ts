import { expect, test, type Page } from "@playwright/test";

/**
 * Covers the graph and explorer against a real analyzed repository.
 * Set E2E_REPO to a public GitHub URL and E2E_FILE to a path with a connection in it.
 */
const repo = process.env.E2E_REPO;
const filePath = process.env.E2E_FILE ?? "";
const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);

test.skip(!repo || !filePath, "Set E2E_REPO and E2E_FILE to run against a real repository.");

let cachedId: string | undefined; // Importing is rate limited, so look the repository up once.

async function repositoryId(page: Page): Promise<string> {
  if (cachedId) return cachedId;
  const response = await page.request.post("/api/repositories/import", { data: { url: repo } });
  expect(response.ok()).toBe(true);
  cachedId = (await response.json()).data.repositoryId as string;
  return cachedId;
}

async function openGraph(page: Page) {
  await page.goto(`/repositories/${await repositoryId(page)}/architecture`);
  await page.locator(".react-flow__node").first().waitFor({ timeout: 45_000 });
}

async function openExplorer(page: Page) {
  await page.goto(`/repositories/${await repositoryId(page)}/explorer`);
  await page.getByRole("navigation", { name: "Files" }).locator("button").first().waitFor();
}

test.describe("graph", () => {
  test("search by keyboard opens a file, and Escape closes it", async ({ page }) => {
    await openGraph(page);

    await page.keyboard.press("/");
    await expect(page.getByLabel("Search files")).toBeFocused();
    await page.keyboard.type(filePath);
    await page.keyboard.press("Enter");

    const panel = page.getByRole("complementary", { name: /Details for/ });
    await expect(panel.getByRole("heading", { name: fileName })).toBeVisible();

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("arrow keys choose a search result", async ({ page }) => {
    await openGraph(page);
    const input = page.getByLabel("Search files");

    await input.fill(fileName.slice(0, 2));
    await input.press("ArrowDown");

    await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  });

  test("a focused node opens with Enter", async ({ page }) => {
    await openGraph(page);

    await page.locator(".react-flow__node-file").first().focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("complementary", { name: /Details for/ })).toBeVisible();
  });

  test("the file panel resizes with the keyboard and remembers it", async ({ page }) => {
    await openGraph(page);
    await page.getByLabel("Search files").fill(filePath);
    await page.getByLabel("Search files").press("Enter");

    const handle = page.getByRole("separator", { name: "Resize file details" });
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 24));

    await page.reload();
    await page.locator(".react-flow__node").first().waitFor({ timeout: 45_000 });
    await page.getByLabel("Search files").fill(filePath);
    await page.getByLabel("Search files").press("Enter");
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 24));
  });

  test("the legend starts folded on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await openGraph(page);

    await expect(page.getByText("Relationships")).toBeHidden();
    await page.getByText("Legend and filters").click();
    await expect(page.getByText("Relationships")).toBeVisible();
  });
});

test.describe("explorer", () => {
  test("the tree works with arrow keys", async ({ page }) => {
    await openExplorer(page);
    const firstFolder = page
      .getByRole("navigation", { name: "Files" })
      .locator("button[aria-expanded]")
      .first();

    await firstFolder.focus();
    await page.keyboard.press("ArrowRight");
    await expect(firstFolder).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(firstFolder).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowDown");
    await expect(firstFolder).not.toBeFocused();
  });

  test("search opens a file, and panels collapse and return", async ({ page }) => {
    await openExplorer(page);

    await page.keyboard.press("/");
    await expect(page.getByLabel("Search file names")).toBeFocused();
    await page.keyboard.type(filePath);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: filePath })).toBeVisible();

    await page.getByRole("button", { name: "Hide file tree" }).click();
    await expect(page.getByLabel("Search file names")).toBeHidden();
    await page.getByRole("button", { name: "Show file tree" }).click();
    await expect(page.getByLabel("Search file names")).toBeVisible();

    await page.getByRole("button", { name: "Hide connections" }).click();
    await expect(page.getByRole("complementary", { name: "File connections" })).toBeHidden();
    await page.getByRole("button", { name: "Show connections" }).click();
    await expect(page.getByRole("complementary", { name: "File connections" })).toBeVisible();
  });
});

for (const path of ["overview", "architecture", "explorer"]) {
  test(`${path} has no sideways scroll on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(`/repositories/${await repositoryId(page)}/${path}`);
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
