import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const result = JSON.parse(await readFile('.dev/vercel-deployment.json', 'utf8'));
if (result.status !== 'ok' || !result.deployment?.url) throw Error('Vercel deployment has not succeeded');
const d = result.deployment, base = d.url.startsWith('https://') ? d.url : `https://${d.url}`;
if (d.readyState !== 'READY') throw Error('Vercel deployment is not ready');
const home = await fetch(base, { signal: AbortSignal.timeout(15000) });
if (!home.ok) throw Error(`Hosted home page returned ${home.status}`);
const html = await home.text();
if (!Buffer.from(html).equals(await readFile('out/index.html'))) throw Error('Hosted home page differs from the tested static export');
if (html.includes('MAINNET — REAL SOL') || html.includes('mainnet-banner')) throw Error('Removed Mainnet banner is still present');
if (html.includes('href="/devnet"') || !html.includes('href="/how-it-works"') || !html.includes('Create your vault')) throw Error('Hosted navigation and onboarding differ from the tested release');
if (!home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) throw Error('Vercel security headers are missing');
const routes = {};
for (const [path, expected] of [['/how-it-works', 'Winternitz signatures'], ['/devnet', 'TEST FUNDS ONLY'], ['/protocol', 'DEVNET']]) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || !(await response.text()).includes(expected)) throw Error(`Hosted route ${path} differs from the tested export`);
  routes[path] = response.status;
}
const manifests = {};
for (const [name, cluster] of [['mainnet-deployment.json', 'mainnet-beta'], ['deployment.json', 'devnet'], ['protocol-deployment.json', 'devnet'], ['token.json', null]]) {
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(15000) });
  const hostedBytes = Buffer.from(await response.arrayBuffer()), localBytes = await readFile(`out/${name}`);
  if (!response.ok || !hostedBytes.equals(localBytes)) throw Error(`Hosted ${name} differs from the tested export`);
  if (!response.headers.get('cache-control')?.includes('no-store')) throw Error(`Hosted ${name} is missing its no-store header`);
  const json = JSON.parse(hostedBytes.toString());
  if (cluster && json.cluster !== cluster) throw Error(`Hosted ${name} contains an unexpected network`);
  manifests[name] = { sha256: createHash('sha256').update(hostedBytes).digest('hex'), cluster, verified: json.verified ?? null };
}
const relayUrl = `${base}/api/mainnet-rpc`, upstream = 'https://solana-rpc.publicnode.com';
const rpc = await fetch(relayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Solana-Client': 'js/1.98.4' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
if (!rpc.ok || !rpc.headers.get('cache-control')?.includes('no-store')) throw Error(`Mainnet RPC relay failed: HTTP ${rpc.status} or missing no-store header`);
const genesis = await rpc.json();
if (genesis.error || genesis.result !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('Mainnet RPC relay returned an unexpected genesis hash');
const unsupported = await fetch(relayUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
if (unsupported.status !== 405 || unsupported.headers.get('allow') !== 'POST') throw Error('Mainnet RPC relay must reject non-POST requests');
const historyUrl = `${base}/api/mainnet-history`;
const history = await fetch(historyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': base }, body: JSON.stringify({ jsonrpc: '2.0', id: 'history-verification', method: 'getGenesisHash', params: [] }), signal: AbortSignal.timeout(25000) });
const historyGenesis = await history.json();
if (!history.ok || historyGenesis.result !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' || !history.headers.get('cache-control')?.includes('no-store')) throw Error('Read-only history relay failed full Mainnet genesis verification');
const historyForbidden = await fetch(historyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'forbidden', method: 'sendTransaction', params: [] }), signal: AbortSignal.timeout(15000) });
if (historyForbidden.status !== 400) throw Error('History relay must reject transaction submission');
const historyGet = await fetch(historyUrl, { signal: AbortSignal.timeout(15000) });
if (historyGet.status !== 405) throw Error('History relay must be POST-only');
const removedCopy = 'Free basic vault software. Solana network fees and permanent account rent apply.';
if (html.includes(removedCopy)) throw Error('Removed homepage copy is still present');
const privatePaths = {};
for (const path of ['/.env.local', '/.mainnet/program.json', '/.dev/vercel/auth.json']) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
  if (response.status !== 404) throw Error(`Private path ${path} is unexpectedly accessible`);
  privatePaths[path] = response.status;
}
const evidence = { url: base, deploymentId: d.id, readyState: d.readyState, checkedAt: new Date().toISOString(), cliVersion: '59.11.7', staticExport: true, readOnlyHistoryFunction: { requestUrl: historyUrl, upstream: 'https://api.mainnet-beta.solana.com', verifiedGenesis: historyGenesis.result, postStatus: history.status, transactionSubmissionRejected: historyForbidden.status, unsupportedMethodStatus: historyGet.status, transactionsSubmitted: 0 }, homeStatus: home.status, securityHeadersVerified: true, routes, manifests, mainnetRpcRelay: { requestUrl: relayUrl, upstream, postStatus: rpc.status, verifiedGenesis: genesis.result, unsupportedMethodStatus: unsupported.status, noStore: true, transactionsSubmitted: 0 }, removedHomepageCopyAbsent: true, privatePaths };
await writeFile('docs/vercel-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
