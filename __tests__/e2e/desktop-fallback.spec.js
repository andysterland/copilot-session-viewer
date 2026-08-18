const { test, expect } = require('@playwright/test');

test('keeps the browser layout free of desktop globals and uses the themed prompt fallback', async ({
  page
}) => {
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/sessions')),
    page.goto('/')
  ]);
  expect(await page.evaluate(() => typeof globalThis.copilotSessionViewer)).toBe('undefined');
  await expect(page.getByTestId('desktop-title-bar')).toHaveCount(0);

  const addDirectory = page.getByTestId('add-dir-btn');
  await addDirectory.click();
  await expect(page.getByTestId('desktop-dialog')).toBeVisible();
  await expect(page.getByText('Add session directory')).toBeVisible();
  await expect(page.getByTestId('desktop-dialog-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('desktop-dialog')).toHaveCount(0);
  await expect(addDirectory).toBeFocused();

  await page.goto('/#/desktop/settings');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: /Session Viewer/ })).toBeVisible();
});
