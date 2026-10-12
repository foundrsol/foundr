import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { base58, concat, from64url } from '../src/core/bytes.ts';
import { Keypair } from '@solana/web3.js';
// Dedicated disposable devnet identities. Never print their secret bytes.
await mkdir('.dev', { recursive: true, mode: 0o700 });
async function make(name: string): Promise<string> {
  try { const existing = Uint8Array.from(JSON.parse(await readFile(`.dev/${name}.json`, 'utf8'))); try { return Keypair.fromSecretKey(existing).publicKey.toBase58(); } finally { existing.fill(0); } } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = from64url(jwk.x!), secret = concat(from64url(jwk.d!), pub);
  await writeFile(`.dev/${name}.json`, JSON.stringify(Array.from(secret)), { mode: 0o600 }); secret.fill(0);
  return base58(pub);
}
const programId = await make('program'), protocolId = await make('protocol'), upgradeAuthority = await make('deployer');
const admin2 = await make('admin2'), admin3 = await make('admin3'), treasury = await make('treasury'), keeper = await make('keeper');
const shellMint = await make('test-shell-mint'), quoteMint = await make('test-quote-mint');
await mkdir('public', { recursive: true });
let exists = false; let previous: {programId:string;verified:boolean} | undefined; try { previous = JSON.parse(await readFile('public/deployment.json','utf8')); exists=!!previous?.verified; } catch {}
if (previous && previous.programId !== programId) {
  if (exists || process.env.SHELL_NEW_DEVELOPMENT_DEPLOYMENT !== '1') throw Error('This source archive excludes private deployment keys. To create a NEW unfunded Devnet fork, set SHELL_NEW_DEVELOPMENT_DEPLOYMENT=1. Prior recovery packages remain tied to their original program; never replace a funded deployment.');
  const rustPath='protocol/programs/shell-protocol/src/lib.rs', sdkPath='src/protocol/client.ts', anchorPath='protocol/Anchor.toml';
  await writeFile(rustPath,(await readFile(rustPath,'utf8')).replace(/declare_id!\("[^"]+"\);/,`declare_id!("${protocolId}");`).replace(/pub const VAULT_PROGRAM: Pubkey = pubkey!\("[^"]+"\);/,`pub const VAULT_PROGRAM: Pubkey = pubkey!("${programId}");`));
  await writeFile(sdkPath,(await readFile(sdkPath,'utf8')).replace(/export const VAULT_ID = new PublicKey\('[^']+'\);/,`export const VAULT_ID = new PublicKey('${programId}');`));
  await writeFile(anchorPath,(await readFile(anchorPath,'utf8')).replace(/shell_protocol = "[^"]+"/,`shell_protocol = "${protocolId}"`));
  const abi=JSON.parse(await readFile('program/shell-v1.abi.json','utf8'));abi.programId=programId;await writeFile('program/shell-v1.abi.json',JSON.stringify(abi,null,2)+'\n');
  const pd=JSON.parse(await readFile('public/protocol-deployment.json','utf8'));Object.assign(pd,{programId:protocolId,upgradeAuthority,verified:false,binarySha256:null,binarySize:null,programData:null,deploymentSlot:null,deploymentSignature:null,idlSha256:null,shellMint:null,quoteMint:null,admins:[],treasuryRecipient:null});await writeFile('public/protocol-deployment.json',JSON.stringify(pd,null,2)+'\n');
  console.info('New unfunded Devnet fork identities selected. Rebuild both programs and regenerate the Anchor IDL before creating any vault identity.');
}
if (!exists) await writeFile('public/deployment.json', JSON.stringify({ cluster: 'devnet', genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', programId, verified: false, binarySha256: null, binarySize: null, programData: null, upgradeAuthority, deploymentSlot: null, deploymentSignature: null, upstreamCommit: '672fc6789b1532ee680f24842d235e0be8737b61', note: 'Reserved development identity. NOT deployed or verified. Funding is disabled.' }, null, 2) + '\n');
console.log(JSON.stringify({ programId, protocolId, upgradeAuthority, admins:[upgradeAuthority,admin2,admin3],treasury,keeper,shellTestMint:shellMint,quoteTestMint:quoteMint,status: 'dedicated development identities only; no deployment or token minting performed' }));
