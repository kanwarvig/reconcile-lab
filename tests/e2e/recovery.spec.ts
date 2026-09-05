import { expect, test } from "@playwright/test";

test("fresh browser run recovers across reload and reconciles without duplicates", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: /Make migration failures/ })).toBeVisible();

  await page.getByRole("button", { name: "Inspect mapping" }).first().click();
  await expect(page.getByText("Source schema drift detected")).toBeVisible();
  await expect(page.getByText(/Row 9: invalid email/)).toBeVisible();

  await page.getByRole("button", { name: "Start staged import" }).first().click();
  await expect(page.getByText("Replayable failure")).toBeVisible();
  await expect(page.getByText("Timeout after destination write")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Replay failed page" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Replay failed page" }).first().click();
  await expect(page.getByTestId("missing-count")).toHaveText("0");
  await expect(page.getByTestId("duplicate-count")).toHaveText("0");

  await page.getByRole("button", { name: "Run bidirectional sync" }).first().click();
  await expect(page.getByText("C-004 changed in both systems", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve source version" }).first().click();
  await expect(page.getByText("RECONCILED", { exact: true })).toBeVisible();
  await expect(page.getByText("Delta Freight Group")).toBeVisible();
  await expect(page.getByTestId("missing-count")).toHaveText("0");
  await expect(page.getByTestId("duplicate-count")).toHaveText("0");
  await page.getByRole("button", { name: "Replay same deltas (no-op)" }).first().click();
  await expect(page.getByText("Cursor replay was a no-op")).toBeVisible();
  await expect(page.getByText("cycle 2", { exact: true })).toBeVisible();
});
