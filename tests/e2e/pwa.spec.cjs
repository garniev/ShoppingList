const {
  test, expect, addItems, item, openTransfer, downloadList, uploadList, exportData
} = require('./fixtures.cjs');

async function controlledPage(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
}

test('cached app works offline, persists edits and transfers files', async ({ page, context }) => {
  await controlledPage(page);
  await addItems(page, 'Milk');
  await context.setOffline(true);
  await page.reload();
  await expect(item(page, 'Milk')).toBeVisible();
  expect(await page.locator('#taskForm').evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  await expect.poll(() => page.evaluate(async () => {
    const icon = await fetch('/assets/icon.svg');
    return icon.ok && (await icon.text()).includes('<svg');
  })).toBe(true);
  await addItems(page, 'Bread');
  await item(page, 'Milk').locator('.task-text').click();
  const { data } = await downloadList(page);
  expect(data.items.map(entry => entry.text).sort()).toEqual(['Bread', 'Milk']);
  await openTransfer(page, 'Import list');
  await uploadList(page, exportData([{ id: 'foreign', text: 'Cheese', completed: false, category: 'Dairy' }]));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.reload();
  await expect(page.locator('.task')).toHaveCount(3);
  await expect(item(page, 'Milk').locator('.task-text')).toHaveAttribute('aria-pressed', 'true');
  await expect(item(page, 'Cheese').locator('.category-button')).toHaveText('Dairy');
  await page.goto('/offline-navigation');
  await expect(page.getByRole('heading', { name: 'Shopping List', exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.goto('/');
  await expect(page.locator('.task')).toHaveCount(3);
});

test('activation removes obsolete caches and precaches the application shell', async ({ page }) => {
  await page.goto('/pwa/manifest.json');
  await page.evaluate(async () => {
    const cache = await caches.open('shopping-list-e2e-obsolete');
    await cache.put('/obsolete', new Response('old'));
  });
  await controlledPage(page);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('shopping-list-e2e-obsolete');
  const cached = await page.evaluate(async () => {
    const paths = ['/index.html', '/css/styles.css', '/js/script.js', '/js/list-transfer.js', '/js/pwa.js', '/assets/icon.svg', '/pwa/manifest.json'];
    return Promise.all(paths.map(async path => Boolean(await caches.match(path))));
  });
  expect(cached.every(Boolean)).toBe(true);
});

test('manifest references valid scoped resources', async ({ page, request }) => {
  await controlledPage(page);
  const manifestURL = await page.locator('link[rel="manifest"]').evaluate(element => element.href);
  const response = await request.get(manifestURL);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe('Shopping List');
  expect(manifest.display).toBe('standalone');
  expect(new URL(manifest.start_url, manifestURL).pathname).toBe('/');
  expect(new URL(manifest.scope, manifestURL).pathname).toBe('/');
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, manifestURL).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/');
  }
});

test('simulated installation events show, invoke and hide the install control', async ({ page }) => {
  await controlledPage(page);
  const install = page.getByRole('button', { name: 'Install app' });
  await expect(install).not.toBeVisible();
  await page.evaluate(() => {
    window.e2ePromptCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => { window.e2ePromptCalls++; };
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(event);
  });
  await expect(install).toBeVisible();
  await install.click();
  await expect(install).not.toBeVisible();
  expect(await page.evaluate(() => window.e2ePromptCalls)).toBe(1);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(event);
  });
  await expect(install).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(install).not.toBeVisible();
});