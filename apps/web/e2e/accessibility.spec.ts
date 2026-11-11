import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated checks find roughly a third of accessibility problems, so these back up the manual
 * pass rather than replace it. Set E2E_REPO to also check a real repository's pages.
 */
const repo = process.env.E2E_REPO;

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

for (const path of ["/", "/login", "/signup", "/no-such-page"]) {
  test(`${path} passes the automated WCAG AA checks`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await violations(page)).toEqual([]);
  });
}

test("the skip link is the first stop and moves focus to the page", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
});

test("reduced motion stops animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const duration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "animate-spin";
    document.body.append(probe);
    return getComputedStyle(probe).animationDuration;
  });
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test.describe("a repository", () => {
  test.skip(!repo, "Set E2E_REPO to check a real repository's pages.");

  let id: string | undefined;
  async function repositoryId(page: Page) {
    if (id) return id;
    const response = await page.request.post("/api/repositories/import", { data: { url: repo } });
    id = (await response.json()).data.repositoryId as string;
    return id;
  }

  for (const tab of ["overview", "architecture", "explorer", "insights", "conventions"]) {
    test(`${tab} passes the automated WCAG AA checks`, async ({ page }) => {
      await page.goto(`/repositories/${await repositoryId(page)}/${tab}`);
      if (tab === "architecture") await page.locator(".react-flow__node").first().waitFor({ timeout: 90_000 });
      else await page.waitForLoadState("networkidle");
      expect(await violations(page)).toEqual([]);
    });
  }
});
