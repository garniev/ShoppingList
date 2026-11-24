const { test, expect, addItems, item, seed, sectionAction } = require('./fixtures.cjs');

test('create multiline items, deduplicate and persist changes', async ({ app }) => {
  await expect(app.getByText('You have no items yet.')).toBeVisible();
  await addItems(app, '  Milk  \nBread\n\n milk ');
  await expect(app.locator('.task-text')).toHaveText(['Milk', 'Bread']);
  await item(app, 'Milk').getByRole('button', { name: 'Complete: Milk', exact: true }).click();
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
  await app.reload();
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
  await addItems(app, 'MILK');
  await expect(app.locator('.task')).toHaveCount(2);
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'false');
  await item(app, 'Bread').getByRole('button', { name: 'Delete item' }).click();
  await app.reload();
  await expect(app.locator('.task-text')).toHaveText(['Milk']);
});

test('blank submissions do nothing and Enter inserts a new line', async ({ app }) => {
  await addItems(app, '  \n  ');
  await expect(app.locator('.task')).toHaveCount(0);
  const input = app.getByRole('textbox', { name: 'Add items' });
  await input.fill('Milk');
  await input.press('End');
  await input.press('Enter');
  await input.pressSequentially('Bread');
  await expect(input).toHaveValue('Milk\nBread');
  await expect(app.locator('.task')).toHaveCount(0);
  await app.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(app.locator('.task-text')).toHaveText(['Milk', 'Bread']);
});

for (const completed of [false, true]) {
  test(`section actions affect only ${completed ? 'bought' : 'pending'} items`, async ({ app }) => {
    await seed(app, [
      { text: 'Zucchini', completed }, { text: 'Apple', completed },
      { text: ' apple ', completed }, { text: 'Other section', completed: !completed }
    ]);
    await sectionAction(app, completed, 'Clean');
    await expect(app.locator('.task')).toHaveCount(3);
    await sectionAction(app, completed, 'Sort');
    const section = app.locator(completed ? '.task.completed .task-text' : '.task:not(.completed) .task-text');
    await expect(section).toHaveText(['Apple', 'Zucchini']);
    await app.reload();
    await expect(section).toHaveText(['Apple', 'Zucchini']);
    await sectionAction(app, completed, 'Delete all');
    await app.reload();
    await expect(app.locator('.task-text')).toHaveText(['Other section']);
  });
}

test('check all, uncheck all and delete all update counts and empty state', async ({ app }) => {
  await addItems(app, 'Milk\nBread');
  await sectionAction(app, false, 'Check all');
  await expect(app.locator('.task.completed')).toHaveCount(2);
  await expect(app.getByText('Bought (2)', { exact: true })).toBeVisible();
  await sectionAction(app, true, 'Uncheck all');
  await expect(app.locator('.task.completed')).toHaveCount(0);
  await expect(app.getByText('To Buy (2)', { exact: true })).toBeVisible();
  await sectionAction(app, false, 'Delete all');
  await app.reload();
  await expect(app.getByText('You have no items yet.')).toBeVisible();
});

test('storage failures show a warning instead of crashing', async ({ app }) => {
  await app.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'task-done-items') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await addItems(app, 'Milk');
  await expect(app.getByRole('status')).toContainText('Changes could not be saved');
  await expect(item(app, 'Milk')).toBeVisible();
  await app.reload();
  await expect(app.locator('.task')).toHaveCount(0);
});