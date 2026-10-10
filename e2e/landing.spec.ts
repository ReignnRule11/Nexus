import { expect, test } from "@playwright/test";

test("root page identifies Project Nexus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Project Nexus" })).toBeVisible();
  await expect(page.getByText("Connect with purpose.")).toBeVisible();
});

test("health endpoint reports application status", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    status: string;
    service: string;
  };
  expect(body.status).toBe("ok");
  expect(body.service).toBe("nexus");
  expect(body).not.toHaveProperty("database");
});
