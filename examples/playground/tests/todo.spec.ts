import { expect, test } from '@playwright/test'

test('adds and toggles a todo', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Todo title').fill('Ship KVT')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('Ship KVT')).toBeVisible()
  await page.getByLabel('Toggle Ship KVT').check()
  await expect(page.getByText('Ship KVT')).toHaveCSS('text-decoration-line', 'line-through')
})
