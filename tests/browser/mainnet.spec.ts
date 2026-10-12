import { PLATFORM_FEE_RECIPIENT } from '../../src/core/platform-fee.ts';
import { test, expect, type Page } from '@playwright/test';
import { Keypair } from '@solana/web3.js';
import { readFile, writeFile } from 'node:fs/promises';
import { MAINNET_GENESIS, DEVNET_GENESIS } from '../../src/core/protocol.ts';
const address = Keypair.generate().publicKey.toBase58(), PASSWORD = 'mainnet-browser-test-password-123';
async function install(page: Page, genesis = MAINNET_GENESIS) {
  await page.addInitScript(address => {
    const publicKey = { toBase58: () => address }, state = { signatures: 0 };
    Object.assign(window, { shellMainnetTest: state, phantom: { solana: { publicKey, connect: async () => ({ publicKey }), disconnect: async () => {}, signTransaction: async () => { state.signatures++; throw Error('Funding gate must prevent signing'); } } } });
  }, address);
  const calls: { url: string; method: string }[] = [];
  await page.route(url => /^https:\/\/(solana-rpc\.publicnode\.com|api\.devnet\.solana\.com)\/?$/.test(url.href) || url.pathname === '/api/mainnet-rpc', async route => {
    const request = route.request().postDataJSON(); calls.push({ url: route.request().url(), method: request.method });
    const isDevnet = route.request().url().includes('api.devnet.');
    const value = request.method === 'getGenesisHash' ? (isDevnet ? DEVNET_GENESIS : genesis) : request.method === 'getBalance' ? { context: { slot: 1 }, value: 500_000_000 } : request.method === 'getAccountInfo' ? { context: { slot: 1 }, value: null } : null;
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: value } });
  });
  return calls;
}
test('Mainnet connects Phantom without a network indicator and keeps undeployed funding separately blocked', async ({ page }) => {
  const calls = await install(page); await page.goto('/');
  await expect(page.locator('.devnet-banner')).toHaveCount(0);
  await expect(page.getByTestId('rpc-status')).toHaveText('Mainnet RPC verified');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.locator('.wallet-card .balance')).toContainText('0.500000000');
  await expect(page.getByTestId('deployment-status')).toContainText('SHELL program not deployed on mainnet');
  await expect(page.getByTestId('rpc-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
  await page.getByText('Connection diagnostics', { exact: true }).click();
  await expect(page.getByTestId('rpc-endpoint')).toHaveText('https://solana-rpc.publicnode.com');
  await expect(page.getByTestId('rpc-genesis')).toHaveText(MAINNET_GENESIS);
  expect(calls.every(c => !c.url.includes('devnet') && c.method !== 'sendTransaction')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { shellMainnetTest: { signatures: number } }).shellMainnetTest.signatures)).toBe(0);
});
test('Mainnet rejects a Devnet RPC hash without disconnecting the wallet', async ({ page }) => {
  await install(page, DEVNET_GENESIS); await page.goto('/'); await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByTestId('rpc-status')).toHaveText('RPC network mismatch');
  await expect(page.getByTestId('rpc-error')).toContainText(`received ${DEVNET_GENESIS}`);
  await expect(page.locator('.wallet-network-note')).toContainText('Connected');
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
});
test('Mainnet real browser encryption, clean recovery and network switching retain isolated identities', async ({ page, browser }) => {
  await install(page); await page.goto('/'); await page.getByRole('button', { name: 'Create your vault', exact: true }).click();
  await page.getByLabel('Choose a recovery password').fill(PASSWORD); await page.getByLabel('Confirm recovery password').fill(PASSWORD); await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download recovery file' }).click(); const download = await downloading, path = (await download.path())!;
  expect(download.suggestedFilename()).toMatch(/^SHELL-mainnet-recovery-/);
  const encrypted = await readFile(path, 'utf8'); expect(encrypted).not.toContain(PASSWORD); expect(encrypted).not.toContain('coordinatorSeed');
  await page.getByLabel('Choose your saved recovery file').setInputFiles(path); await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Verify recovery file' }).click();
  const current = await page.locator('.full-address').textContent(); await page.reload(); await page.getByRole('button', { name: 'Unlock saved vault' }).click(); await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Unlock vault', exact: true }).click(); await expect(page.locator('.full-address')).toHaveText(current!);
  await page.goto('/devnet'); await expect(page.getByRole('button', { name: 'Create your vault', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Restore vault', exact: true }).click(); await page.getByLabel('Encrypted SHELL package').setInputFiles(path); await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Restore from file' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('network mismatch');
  await expect(page.locator('.full-address')).not.toHaveText(current!);
  const clean = await browser.newContext(), recovered = await clean.newPage(); await install(recovered); await recovered.goto('/');
  await recovered.getByRole('button', { name: 'Restore vault', exact: true }).click(); await recovered.getByLabel('Encrypted SHELL package').setInputFiles(path); await recovered.getByLabel('Recovery password', { exact: true }).fill(PASSWORD); await recovered.getByRole('button', { name: 'Restore from file' }).click();
  await expect(recovered.locator('.full-address')).toHaveText(current!); await expect(recovered.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
  await clean.close();
});
test('real pinned Mainnet RPC verifies genesis and the configured release without requesting a transaction', async ({ page }) => {
  test.setTimeout(90000);
  test.skip(process.env.SHELL_LIVE_RPC !== '1' || !process.env.SHELL_BROWSER_URL?.startsWith('https:'), 'Requires deployed HTTPS history verification; Next development does not host the Vercel function');
  await page.goto('/'); await expect(page.getByTestId('rpc-status')).toHaveText('Mainnet RPC verified', { timeout: 20000 });
  const manifest = await page.request.get('/mainnet-deployment.json').then(response => response.json());
  const active = ['ready', 'experimental-ready'].includes(manifest.mainnetRelease?.status);
  if (active) { await page.getByText('Connection diagnostics', { exact: true }).click(); await expect(page.getByTestId('deployment-verification')).toHaveText(/^verified · manifest attestation: present$/, { timeout: 60000 }); await expect(page.getByTestId('deployment-status')).toHaveCount(0); }
  else await expect(page.getByTestId('deployment-status')).toContainText(manifest.verified ? 'Mainnet launch checks are incomplete' : 'SHELL program not deployed on mainnet', { timeout: 20000 });
  const website = process.env.SHELL_BROWSER_URL ?? 'http://127.0.0.1:3000';
  await writeFile('.dev/mainnet-browser-rpc.json', JSON.stringify({checkedAt:new Date().toISOString(), website, rpcEndpoint:'https://solana-rpc.publicnode.com', rpcTransportEndpoint:website.startsWith('https:') ? new URL('/api/mainnet-rpc', website).href : 'https://solana-rpc.publicnode.com', verifiedGenesis:MAINNET_GENESIS, status:'verified', releaseStatus:manifest.mainnetRelease?.status, deploymentFundingAuthorized:active, independentReviewStatus:manifest.mainnetRelease?.securityReview.status, transactionsSubmitted:0},null,2)+'\n');
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
});

test('production Mainnet stays verified when direct browser access to PublicNode is blocked', async ({ page }) => {
  test.skip(process.env.SHELL_LIVE_RPC !== '1' || !process.env.SHELL_BROWSER_URL?.startsWith('https:'), 'Requires the deployed HTTPS RPC relay; local HTTP uses the direct provider');
  test.setTimeout(90000);
  let directRequests = 0;
  const relayRequests: string[] = [];
  await page.route(url => url.origin === 'https://solana-rpc.publicnode.com', route => { directRequests++; return route.abort('blockedbyclient'); });
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/mainnet-rpc') relayRequests.push(request.postDataJSON().method); });
  await page.goto('/');
  await expect(page.getByTestId('rpc-status')).toHaveText('Mainnet RPC verified', { timeout: 20000 });
  await expect(page.getByTestId('rpc-error')).toHaveCount(0);
  await page.getByText('Connection diagnostics', { exact: true }).click();
  await expect(page.getByTestId('rpc-transport')).toHaveText(new URL('/api/mainnet-rpc', process.env.SHELL_BROWSER_URL!).href);
  await expect(page.getByTestId('rpc-genesis')).toHaveText(MAINNET_GENESIS);
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
  expect(directRequests).toBe(0);
  expect(relayRequests).toContain('getGenesisHash');
  expect(relayRequests).not.toContain('sendTransaction');
  await writeFile('.dev/mainnet-rpc-relay-browser.json', JSON.stringify({ checkedAt: new Date().toISOString(), website: process.env.SHELL_BROWSER_URL, rpcProvider: 'https://solana-rpc.publicnode.com', rpcTransportEndpoint: new URL('/api/mainnet-rpc', process.env.SHELL_BROWSER_URL!).href, verifiedGenesis: MAINNET_GENESIS, directBrowserRpcBlocked: true, directRequests, observedRelayMethods: relayRequests, fundingDisabled: true, transactionsSubmitted: 0 }, null, 2) + '\n');
});

// Actual network reads and browser cryptography; no real extension or transfer.
test('RPC-verified Mainnet setup enables activation only for an authorized public release', async ({ page }) => {
  test.setTimeout(90000);
  test.skip(process.env.SHELL_LIVE_RPC !== '1' || !process.env.SHELL_BROWSER_URL?.startsWith('https:'), 'Read-only Mainnet acceptance requires the deployed HTTPS history function');
  let signRequests = 0, sentTransactions = 0;
  await page.exposeFunction('recordUnwantedSignature', () => { signRequests++; });
  await page.addInitScript(address => {
    const publicKey = { toBase58: () => address };
    Object.assign(window, { phantom: { solana: { publicKey, connect: async () => ({ publicKey }), disconnect: async () => {}, signTransaction: async () => { await (window as unknown as { recordUnwantedSignature(): Promise<void> }).recordUnwantedSignature(); throw Error('Read-only acceptance must not request a signature'); } } } });
  }, address);
  page.on('request', request => { if (request.method() === 'POST' && /mainnet-rpc|publicnode\.com/.test(request.url()) && request.postDataJSON()?.method === 'sendTransaction') sentTransactions++; });
  await page.goto('/');
  await expect(page.getByTestId('rpc-status')).toHaveText('Mainnet RPC verified', { timeout: 20000 });
  const manifest = await page.request.get('/mainnet-deployment.json').then(r => r.json());
  const active = ['ready', 'experimental-ready'].includes(manifest.mainnetRelease?.status);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Create your vault', exact: true }).click();
  await page.getByLabel('Choose a recovery password').fill(PASSWORD); await page.getByLabel('Confirm recovery password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download recovery file' }).click();
  const file = await downloading;
  await page.getByLabel('Choose your saved recovery file').setInputFiles((await file.path())!);
  await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Verify recovery file', exact: true }).click();
  const activate = page.getByRole('button', { name: 'Activate vault', exact: true });
  await expect(page.getByRole('button', { name: 'Back up vault', exact: true })).toBeEnabled({ timeout: 60000 });
  if (active) {
    await expect(activate).toBeEnabled({ timeout: 60000 });
    await activate.click();
    await expect(page.getByRole('heading', { name: 'Activate your vault', exact: true })).toBeVisible();
    await expect(page.getByTestId('activation-platform-fee')).toContainText('0.010000000 SOL');
    await page.getByText('Platform fee recipient', { exact: true }).click();
    await expect(page.getByTestId('platform-fee-recipient')).toHaveText(PLATFORM_FEE_RECIPIENT);
  } else await expect(activate).toBeDisabled({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
  expect(signRequests).toBe(0); expect(sentTransactions).toBe(0);
  await writeFile('.dev/experimental-live-activation.json', JSON.stringify({ checkedAt: new Date().toISOString(), website: process.env.SHELL_BROWSER_URL ?? 'http://127.0.0.1:3000', releaseStatus: manifest.mainnetRelease?.status, sourceSha256: manifest.mainnetRelease?.sourceSha256, independentReviewStatus: manifest.mainnetRelease?.securityReview.status, walletInterfaceConnected: true, encryptedIdentityCreated: true, recoveryExportVerified: true, activationEnabled: active, noDepositBeforeActivation: true, signatureRequests: signRequests, transactionsSubmitted: sentTransactions }, null, 2) + '\n');
});
