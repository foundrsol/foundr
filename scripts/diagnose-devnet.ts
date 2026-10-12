// Read-only public evidence. Never load local development keypairs or identities.
import { readFile, writeFile } from 'node:fs/promises';
import { PublicKey } from '@solana/web3.js';
import { SolanaChain, type Deployment } from '../src/solana/chain.ts';
import { DEVNET_RPC, publicDiagnostics } from '../src/solana/network.ts';
const manifest = JSON.parse(await readFile('public/deployment.json', 'utf8')) as Deployment;
const chain = new SolanaChain(manifest);
try { await chain.validate(); } catch { /* Exact public reason is in diagnostics. */ }
if (chain.diagnostics.rpcStatus !== 'verified') throw Error(chain.diagnostics.rpcCause ?? 'Devnet RPC was not verified');
const program = await chain.connection.getAccountInfo(new PublicKey(chain.program), 'finalized');
const protocolManifest = JSON.parse(await readFile('public/protocol-deployment.json', 'utf8'));
const [protocolProgram, deployerBalance] = await Promise.all([
  chain.connection.getAccountInfo(new PublicKey(protocolManifest.programId), 'finalized'),
  chain.connection.getBalance(new PublicKey(manifest.upgradeAuthority!), 'finalized'),
]);
const evidence = {
  endpoint: DEVNET_RPC, genesis: chain.diagnostics.rpcGenesis, programId: chain.program, programExists: !!program,
  programAccount: program ? { executable: program.executable, owner: program.owner.toBase58(), dataBytes: program.data.length } : null,
  slot: await chain.connection.getSlot('finalized'), checkedAt: new Date().toISOString(), diagnostics: publicDiagnostics(chain.diagnostics),
  protocolProgramId: protocolManifest.programId, protocolProgramExists: !!protocolProgram,
  protocolProgramAccount: protocolProgram ? { executable: protocolProgram.executable, owner: protocolProgram.owner.toBase58(), dataBytes: protocolProgram.data.length } : null,
  developmentDeployer: manifest.upgradeAuthority, developmentDeployerLamports: deployerBalance.toString(),
};
await writeFile('docs/devnet-rpc-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.info(JSON.stringify(evidence, null, 2));
