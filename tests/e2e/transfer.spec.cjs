const {
  test, expect, item, seed, openTransfer, downloadList, uploadList, exportData
} = require('./fixtures.cjs');

for (const view of ['List', 'Categories']) {
  test(`export every item in ${view} view and import the downloaded file`, async ({ app }) => {
    await seed(app, [
      { text: 'Milk', category: 'Dairy' }, { text: 'Bread', completed: true, category: 'Bakery' }
    ]);
    await app.getByRole('button', { name: view, exact: true }).click();
    const { download, buffer, data } = await downloadList(app);
    await expect(app.locator('#appStatus')).toContainText('Includes all 2 items');
    expect(download.suggestedFilename()).toMatch(/^shopping-list-\d{4}-\d{2}-\d{2}\.json$/);
    expect(data.format).toBe('shopping-list');
    expect(data.version).toBe(1);
    expect(new Date(data.exportedAt).toISOString()).toBe(data.exportedAt);
    expect(data.items).toEqual([
      { id: 'seed-0', text: 'Milk', completed: false, category: 'Dairy' },
      { id: 'seed-1', text: 'Bread', completed: true, category: 'Bakery' }
    ]);
    expect(data).not.toHaveProperty('theme');
    expect(data).not.toHaveProperty('view');
    await seed(app, []);
    await openTransfer(app, 'Import list');
    await uploadList(app, buffer);
    await expect(app.locator('#importFeedback')).toContainText('2 will be added');
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(app.getByRole('dialog')).not.toBeVisible();
    await app.reload();
    await expect(app.locator('.task')).toHaveCount(2);
    await expect(item(app, 'Bread').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
    await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Dairy');
    await expect(item(app, 'Milk')).not.toHaveAttribute('data-task-id', 'seed-0');
  });
}

test('empty lists can also be exported', async ({ app }) => {
  const { data } = await downloadList(app);
  expect(data.items).toEqual([]);
  await expect(app.locator('#appStatus')).toContainText('Includes all 0 items');
});

test('merge preserves local data, deduplicates and is idempotent', async ({ app }) => {
  await seed(app, [{ text: 'Milk', category: 'Dairy', completed: true }], {
    'theme-preference': 'light', 'task-view-preference': 'categories'
  });
  const shared = exportData([
    { id: 'foreign-0', text: ' milk ', completed: false, category: 'Changed' },
    { id: 'foreign-1', text: 'Cheese', completed: false, category: 'dairy' },
    { id: 'foreign-2', text: ' CHEESE ', completed: true, category: 'Other' }
  ]);
  await openTransfer(app, 'Import list');
  await uploadList(app, shared);
  await expect(app.locator('#importFeedback')).toContainText('1 will be added; 2 matching or repeated names');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.reload();
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
  await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Dairy');
  await expect(item(app, 'Cheese').locator('.category-button')).toHaveText('Dairy');
  await expect(item(app, 'Cheese')).not.toHaveAttribute('data-task-id', 'foreign-1');
  await expect(app.locator('body')).toHaveClass(/light-mode/);
  await expect(app.getByRole('button', { name: 'Categories', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openTransfer(app, 'Import list');
  await uploadList(app, shared);
  await expect(app.locator('#importFeedback')).toContainText('Nothing new to import');
  await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await app.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Import or export list' })).toBeFocused();
});

test('cancel a preview or close with Escape without importing', async ({ app }) => {
  for (const close of ['cancel', 'escape']) {
    await openTransfer(app, 'Import list');
    await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await uploadList(app, exportData([{ id: 'foreign', text: 'Milk', completed: false, category: null }]));
    await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
    if (close === 'cancel') await app.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await app.keyboard.press('Escape');
    await expect(app.getByRole('dialog')).not.toBeVisible();
    await expect(app.locator('.task')).toHaveCount(0);
  }
  await openTransfer(app, 'Import list');
  await expect(app.getByLabel('Choose an exported list')).toHaveValue('');
  await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

const invalidFiles = [
  ['invalid JSON', Buffer.from('{broken')],
  ['unsupported format', { format: 'other', version: 1, items: [] }],
  ['unsupported version', { format: 'shopping-list', version: 99, items: [] }],
  ['invalid items', exportData([{ id: 'bad', text: 42, completed: false, category: null }])],
  ['oversized file', Buffer.alloc(5 * 1024 * 1024 + 1, ' ') ]
];

for (const [label, contents] of invalidFiles) {
  test(`reject ${label} without changing local items`, async ({ app }) => {
    await seed(app, [{ text: 'Local' }]);
    await openTransfer(app, 'Import list');
    await uploadList(app, contents);
    await expect(app.locator('#importFeedback')).not.toHaveText(/Choose a file|Reading list/);
    await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await app.getByRole('button', { name: 'Cancel', exact: true }).click();
    await app.reload();
    await expect(app.locator('.task-text')).toHaveText(['Local']);
  });
}

test('failed import persistence leaves local items unchanged', async ({ app }) => {
  await seed(app, [{ text: 'Local' }]);
  await openTransfer(app, 'Import list');
  await uploadList(app, exportData([{ id: 'foreign', text: 'Milk', completed: false, category: null }]));
  await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await app.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'task-done-items') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(app.locator('#importFeedback')).toContainText('Nothing was imported');
  await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await app.getByRole('button', { name: 'Cancel', exact: true }).click();
  await app.reload();
  await expect(app.locator('.task-text')).toHaveText(['Local']);
});