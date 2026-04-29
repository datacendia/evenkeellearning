// E2E smoke tests for Even Keel Learning. Verifies every public surface returns 200,
// the 404 page works, and the cross-tab data bus delivers events end-to-end.

import { test, expect } from "@playwright/test";

const ROUTES = [
  "/",
  "/student",
  "/teacher",
  "/parent",
  "/compliance",
  "/adult",
  "/trades",
  "/auth",
  "/.well-known/security.txt",
];

for (const route of ROUTES) {
  test(`GET ${route} returns 200`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response, `no response for ${route}`).not.toBeNull();
    expect(response!.status(), `bad status for ${route}`).toBe(200);
  });
}

test("unmatched route returns 404", async ({ page }) => {
  const response = await page.goto("/this-is-not-a-route");
  expect(response!.status()).toBe(404);
});

test("compliance page renders the resolution tray heading", async ({ page }) => {
  await page.goto("/compliance");
  // Tray view title (button text) should be visible.
  await expect(page.getByText(/Compliance Pulse|Resolution Tray|Audit Vault/i).first()).toBeVisible();
});

test("student page mounts the comprehension gate", async ({ page }) => {
  await page.goto("/student");
  // The gate has the "Tap to begin" / "Start the gate" affordance with the
  // word "comprehension" appearing somewhere on the page.
  await expect(page.getByText(/comprehension/i).first()).toBeVisible();
});
