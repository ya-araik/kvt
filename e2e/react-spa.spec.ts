import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/todos");
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeVisible();
  await expect(page.locator(".todo-row").first()).toBeVisible();
});

test("загрузка, серверный поиск, фильтры и пагинация", async ({ page }) => {
  await expect(page.locator(".todo-row")).toHaveCount(20);
  await page.getByPlaceholder("Поиск по названию…").fill("delectus aut autem");
  await expect(page.locator(".todo-row")).toHaveCount(1);
  await expect(page.locator(".todo-row")).toContainText("delectus aut autem");

  await page.getByPlaceholder("Поиск по названию…").clear();
  await expect(page.locator(".todo-row")).toHaveCount(20);
  await page.getByRole("button", { name: "Готовые" }).click();
  await expect(
    page.locator(".todo-row").first().getByRole("checkbox"),
  ).toBeChecked();
  await page.getByRole("button", { name: "Все", exact: true }).click();

  await page.getByRole("button", { name: "Следующая страница" }).click();
  await expect(page.getByText(/Страница 2 из/)).toBeVisible();
});

test("create, edit, toggle и delete сохраняются после reload", async ({
  page,
}, testInfo) => {
  const title = `E2E ${testInfo.project.name} ${Date.now()}`;
  const edited = `${title} — изменено`;
  await page.getByPlaceholder("Например, подготовить релиз").fill(title);
  await page.getByRole("button", { name: "Добавить" }).click();
  const created = page.locator(".todo-row").filter({ hasText: title });
  await expect(created).toBeVisible();

  await created
    .getByRole("button", { name: `Редактировать «${title}»` })
    .click();
  const editor = page.getByLabel("Новое название задачи");
  await editor.fill(edited);
  const editingRow = page.locator(".todo-row").filter({ has: editor });
  await editingRow.getByRole("button", { name: "Сохранить" }).click();
  const updated = page.locator(".todo-row").filter({ hasText: edited });
  await expect(updated).toBeVisible();
  await updated.getByRole("checkbox").click();
  await expect(updated.getByRole("checkbox")).toBeChecked();

  await page.reload();
  await page.getByPlaceholder("Поиск по названию…").fill(edited);
  const restored = page.locator(".todo-row").filter({ hasText: edited });
  await expect(restored).toBeVisible();
  await expect(restored.getByRole("checkbox")).toBeChecked();

  await restored.getByRole("button", { name: `Удалить «${edited}»` }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Удалить" })
    .click();
  await expect(restored).toHaveCount(0);
});

test("IndexedDB показывает cache и синхронизирует offline outbox", async ({
  page,
}, testInfo) => {
  const cachedTitle = await page
    .locator(".todo-row")
    .first()
    .locator(".todo-copy > strong")
    .innerText();
  await page.route("**/api/**", (route) => route.abort("connectionrefused"));
  await page.reload();

  await expect(page.getByText(cachedTitle, { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /Offline-режим: изменения сохраняются локально|Показаны сохранённые данные/,
    ),
  ).toBeVisible();

  const offlineTitle = `Offline ${testInfo.project.name} ${Date.now()}`;
  await page.getByPlaceholder("Например, подготовить релиз").fill(offlineTitle);
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(
    page.locator(".todo-row").filter({ hasText: offlineTitle }),
  ).toBeVisible();

  await page.unroute("**/api/**");
  const synchronized = page.waitForResponse(
    (response) =>
      response.url().includes("/api/todos") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await synchronized;
  await page.waitForTimeout(100);
  await page.reload();
  await page.getByPlaceholder("Поиск по названию…").fill(offlineTitle);
  await expect(
    page.locator(".todo-row").filter({ hasText: offlineTitle }),
  ).toBeVisible();
});

test("выбранная тема сохраняется", async ({ page }) => {
  await page.getByRole("link", { name: "Настройки" }).first().click();
  await page.getByRole("button", { name: /Закат/ }).click();
  await expect(page.getByRole("button", { name: /Закат/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const primary = await page
    .locator("html")
    .evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--kvt-colors-primary"),
    );

  await page.reload();
  await expect(page.getByRole("button", { name: /Закат/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--kvt-colors-primary"),
        ),
    )
    .toBe(primary);
});

test("insights chunk загружается только после навигации", async ({ page }) => {
  const loadedChunks = () =>
    page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
  expect(
    (await loadedChunks()).some((url) => url.includes("insights-route")),
  ).toBe(false);

  await page.getByRole("link", { name: "Аналитика" }).first().click();
  await expect(page.getByRole("heading", { name: "Аналитика" })).toBeVisible();
  await expect
    .poll(async () =>
      (await loadedChunks()).some((url) => url.includes("insights-route")),
    )
    .toBe(true);
});
