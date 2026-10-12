import { test, expect, type Page } from '@playwright/test';
import { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS } from '../../src/core/protocol.ts';
const address = Keypair.generate().publicKey.toBase58();
const changedAddress = Keypair.generate().publicKey.toBase58();

async function phantomWithoutNetworkIndicator(page: Page) {
  await page.addInitScript(({ address, changedAddress }) => {
    const handlers: Record<string, (() => void)[]> = {};
    const state = { signatures: 0 };
    const provider = {
      publicKey: { toBase58: () => address } as { toBase58(): string } | null,
      async connect() { return { publicKey: this.publicKey! }; },
      async disconnect() { this.publicKey = null; for (const handler of handlers.disconnect ?? []) handler(); },
      async signTransaction() { state.signatures++; throw Error('A gated flow must never request a wallet signature'); },
      on(event: string, handler: () => void) { (handlers[event] ??= []).push(handler); },
      off(event: string, handler: () => void) { handlers[event] = (handlers[event] ?? []).filter(value => value !== handler); },
    };
    Object.assign(window, { phantom: { solana: provider }, shellWalletTest: { state, changeAccount() { provider.publicKey = { toBase58: () => changedAddress }; for (const handler of handlers.accountChanged ?? []) handler(); } } });
  }, { address, changedAddress });
}
async function rpc(page: Page, genesis: string | 'timeout' = DEVNET_GENESIS) {
  const methods: string[] = [];
  await page.route(/^https:\/\/api\.devnet\.solana\.com\/?$/, async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }); return; }
    const request = route.request().postDataJSON(); methods.push(request.method);
    const values: Record<string, unknown> = { getGenesisHash: genesis, getAccountInfo: { context: { slot: 1 }, value: null }, getBalance: { context: { slot: 1 }, value: 1_250_000_000 } };
    if (!(request.method in values)) throw Error(`Unexpected RPC method while funding is gated: ${request.method}`);
    const body = genesis === 'timeout' ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'RPC timeout' } } : { jsonrpc: '2.0', id: request.id, result: values[request.method] };
    await route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return methods;
}

test('Phantom connects without network metadata; full Devnet genesis is verified and missing deployment stays separate', async ({ page }) => {
  await phantomWithoutNetworkIndicator(page); const methods = await rpc(page);
  const logs: string[] = []; page.on('console', message => { if (message.text().includes('SHELL devnet diagnostics')) logs.push(message.text()); });
  await page.goto('/devnet'); await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByTestId('rpc-status')).toHaveText('Devnet RPC verified');
  await expect(page.locator('.wallet-network-note')).toContainText('Connected · wallet network not reported');
  await expect(page.locator('.wallet-card .balance')).toContainText('1.250000000');
  await expect(page.getByTestId('rpc-error')).toHaveCount(0);
  await expect(page.getByTestId('deployment-status')).toContainText('SHELL program not deployed on devnet');
  await page.getByText('Connection diagnostics', { exact: true }).click();
  await expect(page.getByTestId('rpc-endpoint')).toHaveText('https://api.devnet.solana.com');
  await expect(page.getByTestId('rpc-genesis')).toHaveText(DEVNET_GENESIS);
  await expect(page.getByTestId('wallet-public-key')).toHaveText(address);
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send SOL', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { shellWalletTest: { changeAccount(): void } }).shellWalletTest.changeAccount());
  await expect(page.getByTestId('wallet-public-key')).toHaveText(changedAddress);
  await page.locator('.wallet-connect button').click(); await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await expect(page.getByTestId('wallet-public-key')).toHaveText('Not connected');
  expect(await page.evaluate(() => (window as unknown as { shellWalletTest: { state: { signatures: number } } }).shellWalletTest.state.signatures)).toBe(0);
  expect(methods).toContain('getGenesisHash'); expect(methods).toContain('getAccountInfo'); expect(methods).not.toContain('sendTransaction'); expect(logs.length).toBeGreaterThan(0);
});
for (const scenario of [
  { genesis: 'unexpected-cluster', status: 'RPC network mismatch', cause: 'received unexpected-cluster' },
  { genesis: 'timeout', status: 'Devnet RPC unavailable', cause: 'RPC timeout' },
]) test(`RPC ${scenario.genesis} retains successful wallet connection and blocks funding`, async ({ page }) => {
  await phantomWithoutNetworkIndicator(page); await rpc(page, scenario.genesis);
  await page.goto('/devnet'); await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.locator('.wallet-network-note')).toContainText('Connected');
  await expect(page.getByTestId('rpc-status')).toHaveText(scenario.status);
  await expect(page.getByTestId('rpc-error')).toContainText(scenario.cause);
  if (scenario.genesis === 'timeout') await expect(page.getByTestId('rpc-error')).not.toContainText('network mismatch');
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
});

test('real official Devnet RPC verifies its full hash in the hosted browser, with no program account', async ({ page }) => {
  test.skip(process.env.SHELL_LIVE_RPC !== '1', 'Opt in to the actual public Devnet RPC; this is not a mocked-network check.');
  await phantomWithoutNetworkIndicator(page); await page.goto('/devnet');
  await expect(page.getByTestId('rpc-status')).toHaveText('Devnet RPC verified', { timeout: 20000 });
  await expect(page.getByTestId('deployment-status')).toContainText('SHELL program not deployed on devnet', { timeout: 20000 });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.locator('.wallet-network-note')).toContainText('Connected');
  await expect(page.locator('.wallet-card .balance')).toContainText('0.000000000', { timeout: 20000 });
  await expect(page.getByTestId('rpc-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
});
