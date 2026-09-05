import { expect, test } from "@playwright/test";

test("fresh visitor understands the run and navigates true application routes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Move customer data. Keep every decision visible." })).toBeVisible();
  await expect(page.getByText("Northstar CRM").first()).toBeVisible();
  await expect(page.getByText("controlled browser simulations")).toBeVisible();

  await page.getByRole("link", { name: /Records/ }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByRole("heading", { name: "Customer records" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: /Start guided run/ }).click();
  await expect(page).toHaveURL(/\/workbench$/);
  await expect(page.getByRole("heading", { name: "Map source fields" })).toBeVisible();
  await expect(page.getByText("Source schema drift detected")).toBeVisible();
  await expect(page.getByText(/Row 9: invalid email/)).toBeVisible();
});

test("run recovers across reload and reconciles without duplicates", async ({ page }) => {
  await page.goto("/workbench");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: /Inspect mapping/ }).first().click();
  await expect(page.getByText("Source schema drift detected")).toBeVisible();
  await page.getByRole("button", { name: /Start staged import/ }).first().click();
  await expect(page.getByText("Replayable failure", { exact: true })).toBeVisible();
  await expect(page.getByText(/Timeout after destination write/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Replay failed page/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Replay failed page/ }).first().click();
  await expect(page.getByTestId("missing-count")).toHaveText("0");
  await expect(page.getByTestId("duplicate-count")).toHaveText("0");

  await page.getByRole("button", { name: /Run bidirectional sync/ }).first().click();
  await expect(page.getByText("C-004 changed in both systems", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Approve source version/ }).first().click();
  await expect(page.getByText("RECONCILED", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: /Records/ }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByText("Delta Freight Group").first()).toBeVisible();
  await page.getByRole("link", { name: /Run workspace/ }).click();
  await page.getByRole("button", { name: /Replay same deltas \(no-op\)/ }).first().click();
  await page.getByRole("link", { name: /History/ }).click();
  await expect(page.getByText("Cursor replay was a no-op")).toBeVisible();
  await expect(page.getByText(/cycle 2/i).first()).toBeVisible();
});

test("mobile workspace uses stage tabs and a contextual drawer without horizontal clipping", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workbench");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Inspect mapping/ }).last()).toBeVisible();
  const stageSelector = page.getByRole("combobox", { name: "Jump to pipeline stage" });
  await expect(stageSelector).toBeVisible();
  await stageSelector.selectOption("audit");
  await expect(page.getByRole("heading", { name: "Audit current run" })).toBeVisible();
  await stageSelector.selectOption("map");
  await page.getByRole("button", { name: /account_status/ }).click();
  await expect(page.getByRole("heading", { name: "status" })).toBeVisible();
  await expect(page.getByText("Schema drift contained")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
  expect(dimensions.scrollWidth).toBe(dimensions.innerWidth);
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationDuration = await page.locator(".liveDot").first().evaluate((node) => parseFloat(getComputedStyle(node).animationDuration));
  expect(animationDuration).toBeLessThan(0.001);
});
