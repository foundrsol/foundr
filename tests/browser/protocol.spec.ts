import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS } from '../../src/core/protocol.ts';
test('contract-address section visibly awaits the real CA and cannot copy a placeholder', async ({ page }) => {
  await page.route('**/token.json', route => route.fulfill({ json: { symbol: '$SHELL', network: 'mainnet-beta', address: null, status: 'awaiting-address' } }));
  await page.goto('/devnet'); await expect(page.getByTestId('token-ca')).toHaveText('Contract address pending');
  await expect(page.getByRole('button', { name: 'Copy SHELL contract address' })).toBeDisabled();
});
test('verified and owner-supplied CAs display in full and copy exactly to the clipboard', async ({ page, context }) => {
  const address = Keypair.generate().publicKey.toBase58(); // Test fixture, never written to public/token.json.
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  for (const status of ['verified', 'owner-provided']) {
    await page.unroute('**/token.json');
    await page.route('**/token.json', route => route.fulfill({ json: { symbol: '$SHELL', network: 'mainnet-beta', address, status } }));
    await page.goto('/devnet'); await expect(page.getByTestId('token-ca')).toHaveText(address);
    if (status === 'owner-provided') await expect(page.getByRole('status').filter({ hasText: 'Project-supplied contract address' })).toBeVisible();
    await page.getByRole('button', { name: 'Copy SHELL contract address' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Contract address copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  }
});
test('protocol dashboard shows no invented financial metrics while deployment is missing; mobile page fits', async ({ page }) => {
  await page.route(/^https:\/\/api\.devnet\.solana\.com\/?$/, route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: request.method === 'getGenesisHash' ? DEVNET_GENESIS : { context: { slot: 1 }, value: null } } });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/protocol');
  await expect(page.getByTestId('protocol-state')).toContainText('No SHELL program account exists');
  const metrics = page.getByTestId('protocol-metric'); await expect(metrics).toHaveCount(8);
  for (const metric of await metrics.all()) await expect(metric).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Review enterprise payment' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Register & stake' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'SPL quote', exact: true }).click(); for (const metric of await metrics.all()) await expect(metric).toHaveText('—');
});
