const { test: base, expect } = require('@playwright/test');

const test = base.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Shopping List', exact: true })).toBeVisible();
    await use(page);
    expect(errors, 'No uncaught application errors').toEqual([]);
  }
});

async function addItems(page, text) {
  await page.getByRole('textbox', { name: 'Add items' }).fill(text);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
}

function item(page, name) {
  return page.locator('.task').filter({ has: page.locator('.task-text').filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
}

async function seed(page, items, preferences = {}) {
  await page.goto('/');
  await page.evaluate(({ items, preferences }) => {
    localStorage.clear();
    localStorage.setItem('task-done-items', JSON.stringify(items.map((entry, index) => ({
      id: `seed-${index}`, completed: false, category: null, ...entry
    }))));
    for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value);
  }, { items, preferences });
  await page.reload();
}

async function assignCategory(page, name, category) {
  await item(page, name).getByRole('button', { name: /^Assign category/ }).click();
  await page.getByLabel('Or create a category').fill(category);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

async function sectionAction(page, completed, action) {
  await page.locator('.task-group-header').filter({ hasText: completed ? 'Bought (' : 'To Buy (' })
    .getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

async function openTransfer(page, action) {
  await page.getByRole('button', { name: 'Import or export list' }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

async function downloadList(page) {
  const pending = page.waitForEvent('download');
  await openTransfer(page, 'Export list');
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const { readFile } = require('node:fs/promises');
  const buffer = await readFile(await download.path());
  return { download, buffer, data: JSON.parse(buffer.toString('utf8')) };
}

async function uploadList(page, contents) {
  await page.getByLabel('Choose an exported list').setInputFiles({
    name: 'shared-list.json', mimeType: 'application/json',
    buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(JSON.stringify(contents))
  });
}

function exportData(items) {
  return { format: 'shopping-list', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', items };
}

module.exports = {
  test, expect, addItems, item, seed, assignCategory, sectionAction, openTransfer,
  downloadList, uploadList, exportData
};