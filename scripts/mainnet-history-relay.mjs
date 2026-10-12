// Read-only public owner-lifecycle history. No keys, cryptography, arbitrary
// RPC destinations, wallet transactions or analytics are hosted here.
import { readFile } from 'node:fs/promises';
export function allowedHistoryRequest(body, signatures) {
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof body.id) || Object.keys(body).some(k => !['jsonrpc', 'id', 'method', 'params'].includes(k))) return false;
  const p = body.params ?? [];
  if (!Array.isArray(p)) return false;
  if (body.method === 'getGenesisHash') return p.length === 0;
  if (body.method === 'getSignatureStatuses') return p.length === 2 && Array.isArray(p[0]) && p[0].length > 0 && p[0].length <= 6 && p[0].every(s => signatures.includes(s)) && p[1]?.searchTransactionHistory === true && Object.keys(p[1]).length === 1;
  if (body.method === 'getTransaction') return p.length === 2 && signatures.includes(p[0]) && p[1]?.commitment === 'finalized' && p[1].maxSupportedTransactionVersion === 0 && (p[1].encoding === undefined || p[1].encoding === 'json') && Object.keys(p[1]).every(k => ['commitment', 'maxSupportedTransactionVersion', 'encoding'].includes(k));
  return false;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.statusCode = 405; res.end('{"error":"POST required"}'); return; }
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += Buffer.byteLength(chunk); if (length > 4096) throw Error('limit'); chunks.push(Buffer.from(chunk)); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const signatures = JSON.parse(await readFile(new URL('./owner-lifecycle.json', import.meta.url), 'utf8'));
    if (!allowedHistoryRequest(body, signatures)) { res.statusCode = 400; res.end('{"error":"Unsupported history request"}'); return; }
    // Construct fresh headers: the official RPC rejects browser Origin.
    const upstream = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    res.statusCode = upstream.status;
    res.end(await upstream.text());
  } catch { res.statusCode = 502; res.end('{"error":"History verification unavailable"}'); }
}
