import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const PASSWORD = 'browser-recovery-password-123';
test('real browser: create, encrypted export/verification, reload/unlock and clean-profile recovery', async ({ page, browser }) => {
  // Slow real decryption to force overlap with UI refreshes. The app must wait
  // for its own refresh without relaxing the cross-tab signing lock.
  await page.addInitScript(() => {
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args: Parameters<SubtleCrypto['decrypt']>) => { await new Promise(resolve => setTimeout(resolve, 400)); return decrypt(...args); };
  });
  await page.goto('/devnet'); await expect(page.getByText('DEVNET — TEST FUNDS ONLY', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Create your vault', exact: true }).click();
  await page.getByLabel('Choose a recovery password').fill(PASSWORD); await page.getByLabel('Confirm recovery password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download recovery file' }).click(); const file = await download;
  const path = await file.path(); const text = await readFile(path!, 'utf8'); expect(text).toContain('SHELL-RECOVERY-1'); expect(text).not.toContain(PASSWORD); expect(text).not.toContain('coordinatorSeed');
  await page.getByLabel('Choose your saved recovery file').setInputFiles(path!); await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Verify recovery file' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const address = await page.locator('.full-address').textContent(); await page.reload(); await page.getByRole('button', { name: 'Unlock saved vault' }).click();
  await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Unlock vault', exact: true }).click(); await expect(page.locator('.full-address')).toHaveText(address!);
  const clean = await browser.newContext(); const recovered = await clean.newPage(); await recovered.goto('/devnet'); await recovered.getByRole('button', { name: 'Restore vault', exact: true }).click();
  await recovered.getByLabel('Encrypted SHELL package').setInputFiles(path!); await recovered.getByLabel('Recovery password', { exact: true }).fill(PASSWORD);
  await recovered.getByRole('button', { name: 'Restore from file' }).click(); await expect(recovered.locator('.full-address')).toHaveText(address!);
  await expect(recovered.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled(); await clean.close();
});
test('responsive navigation explains setup, returns to the vault and preserves appearance without a Devnet option', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/devnet');
  await expect(page.getByRole('button', { name: 'Create your vault', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const appearance = await page.locator('html').getAttribute('data-appearance');
  const navigation = page.getByRole('navigation', { name: 'SHELL navigation' });
  await expect(navigation.getByRole('link', { name: 'Devnet', exact: true })).toHaveCount(0);
  await navigation.getByRole('link', { name: 'How it Works', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every spend changes the shell', exact: true })).toBeVisible();
  await page.getByText('How do I get started?', { exact: true }).click();
  await expect(page.getByText('Save and verify your recovery file.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How it Works', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance!);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Set up your vault', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create your vault', exact: true })).toBeEnabled();
  await expect(page.locator('.next-step')).toContainText('Start here');
  await expect(page.getByRole('link', { name: 'Wallet', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Devnet', exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance!);
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
});
test('browser storage that ignores strict durability cannot create a signing identity', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(IDBTransaction.prototype, 'durability', { configurable: true, get: () => 'relaxed' }));
  await page.goto('/devnet'); await page.getByRole('button', { name: 'Create your vault', exact: true }).click();
  await page.getByLabel('Choose a recovery password').fill(PASSWORD); await page.getByLabel('Confirm recovery password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('This browser cannot provide strict durable storage.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download recovery file' })).toHaveCount(0);
  const saved = await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('shell-encrypted-v1', 1);
    request.onsuccess = () => { const db = request.result; const read = db.transaction('identity').objectStore('identity').get('vault'); read.onsuccess = () => { resolve(!!read.result); db.close(); }; };
  }));
  expect(saved).toBe(false);
});
