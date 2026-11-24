const { test, expect, addItems, item, assignCategory, seed } = require('./fixtures.cjs');

test('create, reuse and remove categories with focus restoration', async ({ app }) => {
  await addItems(app, 'Milk\nBread');
  await assignCategory(app, 'Milk', '  Fresh   Food  ');
  await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Fresh Food');
  await expect(item(app, 'Milk').locator('.category-button')).toBeFocused();
  await assignCategory(app, 'Bread', 'fresh food');
  await expect(item(app, 'Bread').locator('.category-button')).toHaveText('Fresh Food');
  await app.reload();
  await item(app, 'Milk').locator('.category-button').click();
  await expect(app.getByLabel('Category', { exact: true })).toBeFocused();
  await app.getByLabel('Category', { exact: true }).selectOption('');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Uncategorized');
  await item(app, 'Milk').locator('.category-button').click();
  await app.getByLabel('Category', { exact: true }).selectOption('Fresh Food');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await app.reload();
  await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Fresh Food');
});

test('cancel and Escape leave category unchanged', async ({ app }) => {
  await addItems(app, 'Milk');
  for (const cancel of ['button', 'escape']) {
    await item(app, 'Milk').locator('.category-button').click();
    await app.getByLabel('Or create a category').fill('Not saved');
    if (cancel === 'button') await app.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await app.keyboard.press('Escape');
    await expect(app.getByRole('dialog')).not.toBeVisible();
    await expect(item(app, 'Milk').locator('.category-button')).toBeFocused();
    await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Uncategorized');
  }
});

test('category groups sort pending items, leave bought separate and persist the view', async ({ app }) => {
  await seed(app, [
    { text: 'Unassigned' }, { text: 'Milk', category: 'Dairy' },
    { text: 'Apple', category: 'Produce' }, { text: 'Cheese', category: 'Dairy' },
    { text: 'Bought', category: 'Dairy', completed: true }
  ]);
  await app.getByRole('button', { name: 'Categories', exact: true }).click();
  await expect(app.locator('.category-group-header')).toHaveText(['Dairy (2)', 'Produce (1)', 'Uncategorized (1)']);
  await expect(app.locator('.task-text')).toHaveText(['Milk', 'Cheese', 'Apple', 'Unassigned', 'Bought']);
  await app.reload();
  await expect(app.getByRole('button', { name: 'Categories', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await app.getByRole('button', { name: 'List', exact: true }).click();
  await expect(app.locator('.category-group-header')).toHaveCount(0);
  await expect(app.locator('.task-text')).toHaveText(['Unassigned', 'Milk', 'Apple', 'Cheese', 'Bought']);
  await app.reload();
  await expect(app.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
});