const { test, expect, item, seed } = require('./fixtures.cjs');

test.beforeEach(async ({ app }) => {
  await seed(app, [
    { text: 'Milk', completed: true, category: 'Dairy' },
    { text: 'Milk chocolate', category: 'Treats' }
  ]);
});

for (const method of ['click', 'keyboard', 'touch']) {
  test(`suggestions support ${method} and reactivate without losing identity or category`, async ({ app, browserName }, testInfo) => {
    test.skip(method === 'touch' && !testInfo.project.use.hasTouch, 'Touch requires a mobile project');
    const input = app.getByRole('textbox', { name: 'Add items' });
    await input.fill('MIL');
    const suggestions = app.getByRole('group', { name: 'Matching items' });
    await expect(suggestions.getByRole('button')).toHaveText(['Milk', 'Milk chocolate']);
    const option = suggestions.getByRole('button', { name: 'Milk', exact: true });
    if (method === 'keyboard') {
      await input.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
      await expect(option).toBeFocused();
      await option.press('Enter');
    } else if (method === 'touch') await option.tap();
    else await option.click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(item(app, 'Milk')).toHaveAttribute('data-task-id', 'seed-0');
    await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'false');
    await expect(item(app, 'Milk').locator('.category-button')).toHaveText('Dairy');
    await app.reload();
    await expect(app.locator('.task')).toHaveCount(2);
    await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'false');
  });
}

test('select only the cursor line and never duplicate a pending item', async ({ app }) => {
  const input = app.getByRole('textbox', { name: 'Add items' });
  await input.fill('Bread\nchoc\nEggs');
  await input.press('ArrowUp');
  const suggestions = app.getByRole('group', { name: 'Matching items' });
  await suggestions.getByRole('button', { name: 'Milk chocolate', exact: true }).click();
  await expect(input).toHaveValue('Bread\n\nEggs');
  await expect(app.locator('.task')).toHaveCount(2);
});

test('Escape and leaving the input dismiss suggestions', async ({ app }) => {
  const input = app.getByRole('textbox', { name: 'Add items' });
  const suggestions = app.getByRole('group', { name: 'Matching items' });
  await input.fill('milk');
  await expect(suggestions).toBeVisible();
  await input.press('Escape');
  await expect(suggestions).not.toBeVisible();
  await input.press('ArrowLeft');
  await expect(suggestions).toBeVisible();
  await app.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(suggestions).not.toBeVisible();
});

test('a pending match takes priority over a historical completed duplicate', async ({ app }) => {
  await seed(app, [
    { text: 'Milk', completed: true, category: 'Dairy' },
    { text: 'MILK', category: 'Other' }
  ]);
  await app.getByRole('textbox', { name: 'Add items' }).fill('milk');
  const suggestions = app.getByRole('group', { name: 'Matching items' });
  await expect(suggestions.getByRole('button')).toHaveCount(1);
  await suggestions.getByRole('button', { name: 'MILK', exact: true }).click();
  await expect(app.locator('.task.completed')).toHaveCount(1);
  await expect(item(app, 'MILK').locator('.category-button')).toHaveText('Other');
});