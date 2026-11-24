const { test, expect, addItems, item, seed } = require('./fixtures.cjs');

test('transfer menu supports keyboard navigation, Escape and outside click', async ({ app }) => {
  const trigger = app.getByRole('button', { name: 'Import or export list' });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(app.getByRole('menuitem', { name: 'Export list' })).toBeFocused();
  await app.keyboard.press('End');
  await expect(app.getByRole('menuitem', { name: 'Import list' })).toBeFocused();
  await app.keyboard.press('ArrowDown');
  await expect(app.getByRole('menuitem', { name: 'Export list' })).toBeFocused();
  await app.keyboard.press('ArrowUp');
  await expect(app.getByRole('menuitem', { name: 'Import list' })).toBeFocused();
  await app.keyboard.press('Home');
  await expect(app.getByRole('menuitem', { name: 'Export list' })).toBeFocused();
  await app.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await app.getByRole('heading', { name: 'Shopping List', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('section menus close on Escape and opening a different menu', async ({ app }) => {
  await addItems(app, 'Milk');
  const section = app.getByRole('button', { name: 'More actions' });
  await section.click();
  await expect(app.getByRole('menuitem', { name: 'Sort', exact: true })).toBeVisible();
  await app.getByRole('button', { name: 'Import or export list' }).click();
  await expect(section).toHaveAttribute('aria-expanded', 'false');
  await app.keyboard.press('Escape');
  await expect(app.getByRole('menuitem')).toHaveCount(0);
});

test('both theme preferences survive reload', async ({ app }) => {
  await expect(app.locator('body')).not.toHaveClass(/light-mode/);
  await app.getByRole('button', { name: 'Toggle theme' }).click();
  await app.reload();
  await expect(app.locator('body')).toHaveClass(/light-mode/);
  await app.getByRole('button', { name: 'Toggle theme' }).click();
  await app.reload();
  await expect(app.locator('body')).not.toHaveClass(/light-mode/);
});

test('scrolling keeps the form sticky and the layout fits the viewport', async ({ app }, testInfo) => {
  await seed(app, Array.from({ length: 45 }, (_, index) => ({
    text: `Item ${index}: fresh vegetables and fruit for the weekly shopping list`
  })));
  await app.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(app.locator('#taskForm')).toHaveClass(/is-sticky/);
  await expect(app.getByRole('textbox', { name: 'Add items' })).toBeInViewport();
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await testInfo.attach('scrolled-layout', { body: await app.screenshot(), contentType: 'image/png' });
  await app.evaluate(() => window.scrollTo(0, 0));
  await expect(app.locator('#taskForm')).not.toHaveClass(/is-sticky/);
  await item(app, 'Item 0: fresh vegetables and fruit for the weekly shopping list').locator('.category-button').click();
  await expect(app.getByRole('dialog')).toBeInViewport();
  await expect(app.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await testInfo.attach('category-dialog', { body: await app.screenshot(), contentType: 'image/png' });
});

test('long press opens categories without completing the item', async ({ app }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Native mouse gesture is desktop-only');
  await addItems(app, 'Milk');
  await item(app, 'Milk').locator('.task-text').hover();
  await app.mouse.down();
  await expect(app.getByRole('dialog', { name: 'Assign category' })).toBeVisible();
  await app.mouse.up();
  await app.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'false');
});

test('moving during a hold cancels category activation', async ({ app }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Native mouse gesture is desktop-only');
  await addItems(app, 'Milk');
  await app.clock.install();
  const bounds = await item(app, 'Milk').locator('.task-text').boundingBox();
  await app.mouse.move(bounds.x + 5, bounds.y + 5);
  await app.mouse.down();
  await app.mouse.move(bounds.x + 30, bounds.y + 5);
  await app.clock.runFor(600);
  await app.mouse.up();
  await expect(app.getByRole('dialog')).not.toBeVisible();
});

test('touch pointer hold and cancellation integration', async ({ app }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, 'Touch pointer integration is mobile-only');
  await addItems(app, 'Milk');
  await app.clock.install();
  const card = item(app, 'Milk');
  const pointer = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 };
  await card.dispatchEvent('pointerdown', pointer);
  await card.dispatchEvent('pointermove', { ...pointer, clientX: 40 });
  await app.clock.runFor(600);
  await card.dispatchEvent('pointerup', pointer);
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await card.dispatchEvent('pointerdown', pointer);
  await app.clock.runFor(600);
  await expect(app.getByRole('dialog', { name: 'Assign category' })).toBeVisible();
  await card.dispatchEvent('pointerup', pointer);
  await app.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.locator('.task-text')).toHaveAttribute('aria-pressed', 'false');
});

test('drag reorders tasks and adopts the destination completion state', async ({ app }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'HTML drag-and-drop is desktop-only');
  await seed(app, [{ text: 'Milk' }, { text: 'Bread' }, { text: 'Bought', completed: true }]);
  const destination = item(app, 'Bread');
  const bounds = await destination.boundingBox();
  await item(app, 'Milk').dragTo(destination, { targetPosition: { x: 8, y: bounds.height - 4 } });
  await expect(app.locator('.task-text')).toHaveText(['Bread', 'Milk', 'Bought']);
  await app.reload();
  await expect(app.locator('.task-text')).toHaveText(['Bread', 'Milk', 'Bought']);
  await item(app, 'Milk').dragTo(item(app, 'Bought'), { targetPosition: { x: 8, y: 4 } });
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
  await app.reload();
  await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
});

test('category view permits same-group dragging but rejects cross-group drops', async ({ app }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'HTML drag-and-drop is desktop-only');
  await seed(app, [
    { text: 'Milk', category: 'Dairy' }, { text: 'Cheese', category: 'Dairy' },
    { text: 'Apple', category: 'Produce' }, { text: 'Bought', completed: true }
  ]);
  await app.getByRole('button', { name: 'Categories', exact: true }).click();
  const bounds = await item(app, 'Cheese').boundingBox();
  await item(app, 'Milk').dragTo(item(app, 'Cheese'), { targetPosition: { x: 8, y: bounds.height - 4 } });
  await expect(app.locator('.task-text')).toHaveText(['Cheese', 'Milk', 'Apple', 'Bought']);
  for (const destination of ['Apple', 'Bought']) {
    await item(app, 'Milk').dragTo(item(app, destination), { targetPosition: { x: 8, y: 4 } });
    await expect(app.locator('.task-text')).toHaveText(['Cheese', 'Milk', 'Apple', 'Bought']);
    await expect(item(app, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'false');
  }
  await app.reload();
  await expect(app.locator('.task-text')).toHaveText(['Cheese', 'Milk', 'Apple', 'Bought']);
});