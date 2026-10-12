// Convert the already-tested static Next.js export to Vercel Build Output v3.
// Only public assets enter the bundle. Local credentials and vault packages
// remain outside .vercel/output and are never sent to the hosting provider.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const settings = JSON.parse(await readFile('vercel.json', 'utf8'));
await readFile('out/index.html');
await mkdir('.vercel/output', { recursive: true });
await rm('.vercel/output/static', { recursive: true, force: true });
await cp('out', '.vercel/output/static', { recursive: true });
const historyDirectory = '.vercel/output/functions/api/mainnet-history.func';
await mkdir(historyDirectory, { recursive: true });
await cp('scripts/mainnet-history-relay.mjs', `${historyDirectory}/index.mjs`);
const mainnet = JSON.parse(await readFile('out/mainnet-deployment.json', 'utf8'));
await writeFile(`${historyDirectory}/owner-lifecycle.json`, JSON.stringify(mainnet.mainnetRelease?.smoke?.signatures ?? []));
await writeFile(`${historyDirectory}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: true }));
const routes = settings.headers.map(rule => ({ src: rule.source, headers: Object.fromEntries(rule.headers.map(header => [header.key, header.value])), continue: true }));
// Fixed external rewrite preserves JSON-RPC POST bodies without a cross-origin
// browser request. No credential, secret or cryptography is hosted here.
if (settings.rewrites?.length !== 1 || settings.rewrites[0].source !== '/api/mainnet-rpc' || settings.rewrites[0].destination !== 'https://solana-rpc.publicnode.com/') throw Error('Mainnet relay must use the pinned route and provider root.');
routes.push({ src: '^/api/mainnet-history$', dest: '/api/mainnet-history', headers: { 'Cache-Control': 'no-store' } }, { src: '^/api/mainnet-rpc$', methods: ['POST'], dest: 'https://solana-rpc.publicnode.com/', headers: { 'Cache-Control': 'no-store' } }, { src: '^/api/mainnet-rpc$', status: 405, headers: { 'Allow': 'POST', 'Cache-Control': 'no-store' } });
routes.push({ src: '/_next/static/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true }, { src: '^/how-it-works/?$', dest: '/how-it-works.html' }, { src: '^/devnet/?$', dest: '/devnet.html' }, { src: '^/protocol/?$', dest: '/protocol.html' }, { handle: 'filesystem' }, { src: '/.*', dest: '/404.html', status: 404 });
await writeFile('.vercel/output/config.json', JSON.stringify({ version: 3, routes }, null, 2) + '\n');
console.log('Public static export prepared for Vercel. Solana deployment verification is unchanged.');
