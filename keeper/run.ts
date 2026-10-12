import { readFile, mkdir } from 'node:fs/promises';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { ProtocolClient, type ProtocolDeployment } from '../src/protocol/client.ts';
import { AccountingDatabase } from './database.ts';
import { SettlementKeeper } from './settlement.ts';
await mkdir('.dev', { recursive: true, mode: 0o700 });
const client = new ProtocolClient(JSON.parse(await readFile('public/protocol-deployment.json', 'utf8')) as ProtocolDeployment);
const database = new AccountingDatabase(process.env.SHELL_KEEPER_DATABASE ?? '.dev/keeper.sqlite'), keeper = new SettlementKeeper(client, database);
let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    const config = await client.validate();
    for (const job of database.pending()) await keeper.reconcile(job, process.env.SHELL_KEEPER_EXECUTE === '1');
    await keeper.syncAccounting();
    for (const mint of [NATIVE_MINT, config.quoteMint]) {
      const job = await keeper.quote(await client.config(), mint); if (!job) continue;
      if (process.env.SHELL_KEEPER_EXECUTE !== '1') { console.info(JSON.stringify({ status: 'preview only; no transaction signed', job })); continue; }
      if (!process.env.SHELL_KEEPER_KEYFILE) throw Error('An explicit disposable Devnet keeper keyfile is required. Never use a user vault key.');
      const bytes = Uint8Array.from(JSON.parse(await readFile(process.env.SHELL_KEEPER_KEYFILE, 'utf8'))), payer = Keypair.fromSecretKey(bytes); bytes.fill(0);
      console.info(JSON.stringify({ job: job.id, state: await keeper.submit(job, payer), receipt: job.receipt }));
    }
  } catch (error) { console.error(`Keeper stopped safely: ${(error as Error).message}`); if (process.argv.includes('--once')) process.exitCode = 1; }
  finally { running = false; }
}
await tick();
if (!process.argv.includes('--once')) { const interval = setInterval(() => void tick(), 60_000); for (const sig of ['SIGTERM','SIGINT']) process.on(sig, () => { clearInterval(interval); if (!running) database.close(); process.exit(0); }); }
else database.close();
