// Release preparation and read-only verification. Never requests an airdrop,
// constructs a user's transaction, or silently changes a Devnet deployment.
import { chmod, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { authorizationContext, assertNetwork } from '../src/core/protocol.ts';
import { MAINNET_DEPLOY_RPC } from '../src/solana/network.ts';
import { SolanaChain, type Deployment } from '../src/solana/chain.ts';
import { releaseSourceSha256 } from './release-source.ts';
import { assertMainnetDeployment } from './mainnet-deployment.ts';
import { experimentalLaunchMatches, type ExperimentalLaunch } from '../src/solana/release.ts';

const mode = process.argv[2] ?? 'preflight', forDeployment = process.argv.includes('--deployment');
if (!['prepare', 'preflight', 'verify', 'release'].includes(mode)) throw Error('Use prepare, preflight, verify, or release');
const binaryPath = 'program/target/deploy/mainnet/shell_vault.so';
const path = 'public/mainnet-deployment.json', context = authorizationContext('mainnet-v2');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await mkdir('.mainnet', { recursive: true, mode: 0o700 }); await chmod('.mainnet', 0o700);
async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
async function optional<T>(file: string): Promise<T | null> { try { return await json<T>(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function key(name: string): Promise<Keypair> {
  const file = `.mainnet/${name}.json`; const existing = await optional<number[]>(file);
  if (existing) { if (((await stat(file)).mode & 0o077) !== 0) throw Error(`${file} must be private (chmod 600)`); return Keypair.fromSecretKey(Uint8Array.from(existing)); }
  if (mode !== 'prepare') throw Error(`Missing ${file}. Run npm run prepare:mainnet first.`);
  const value = Keypair.generate(); await writeFile(file, JSON.stringify(Array.from(value.secretKey)), { mode: 0o600, flag: 'wx' }); return value;
}
let manifest = await optional<Deployment>(path);
if (mode === 'prepare' && manifest && !await optional<number[]>('.mainnet/program.json')) {
  if (process.env.SHELL_NEW_MAINNET_RESERVATION !== '1') throw Error('This source contains a public reservation, not its private deployment key. Keep the owner key or explicitly create a new unfunded fork with SHELL_NEW_MAINNET_RESERVATION=1. Existing recovery packages cannot migrate.');
  if (manifest.verified) throw Error('Refusing to replace a verified Mainnet deployment.');
  const rpc = new Connection(MAINNET_DEPLOY_RPC, { commitment: 'finalized', disableRetryOnRateLimit: true });
  assertNetwork(await rpc.getGenesisHash(), 'mainnet-v2');
  if (await rpc.getAccountInfo(new PublicKey(manifest.programId), 'finalized')) throw Error('The prior program exists on Mainnet. Refusing to replace it.');
  manifest = null;
}
const programKey = await key('program'), payer = await key('deployer');
if (manifest && (manifest.programId !== programKey.publicKey.toBase58() || manifest.cluster !== context.cluster || manifest.authorizationProfile !== 'mainnet-v2')) throw Error('Existing Mainnet reservation differs. Refusing to replace it.');
manifest ??= { cluster: context.cluster, genesis: context.genesis, authorizationProfile: 'mainnet-v2', programId: programKey.publicKey.toBase58(), verified: false, binarySha256: null, binarySize: null, programData: null, upgradeAuthority: null, deploymentSlot: null, deploymentSignature: null, upstreamCommit: '672fc6789b1532ee680f24842d235e0be8737b61', mainnetRelease: { status: 'review-required', securityReview: { status: 'pending', reportUrl: null, reportSha256: null, reviewedBinarySha256: null, reviewedSourceSha256: null }, compiledTestsPassed: false, sourceSha256: null, smoke: null }, note: 'Mainnet-v2 reservation from a dedicated development key. No deployment or independent review is claimed. Funding is disabled.' };
if (mode === 'prepare') {
  await key('buffer');
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  const abi = await json<Record<string, unknown>>('program/shell-v1.abi.json');
  delete abi.authorizationDomainV1;
  abi.rpcGenesisHash = context.genesis;
  abi.spendingDigest = 'SHA256(utf8(SHELL_MAINNET_V2) || utf8(full Mainnet genesis) || program32 || vault32 || root32 || coordinator32 || OperationV1)';
  const layout = abi.VaultV1 as { fields: { name: string; value?: number }[] };
  layout.fields.find(field => field.name === 'version')!.value = 2;
  abi.VaultV2 = layout; delete abi.VaultV1;
  await writeFile('program/shell-mainnet-v2.abi.json', JSON.stringify({ ...abi, name: 'shell_vault_mainnet_v2', programId: manifest.programId, cluster: context.cluster, accountVersion: 2, authorizationProfile: 'mainnet-v2', authorizationDomain: { tag: context.tag, genesis: context.domain }, upgradePolicy: 'immutable; deploy --final', note: 'Manual Pinocchio ABI, not an Anchor IDL. The instruction encoding is unchanged; account version and authorization domain are distinct.' }, null, 2) + '\n');
  console.log(JSON.stringify({ action: 'reserved only; nothing deployed', programId: manifest.programId, feePayer: payer.publicKey.toBase58(), network: context.cluster, upgradePolicy: 'immutable', fundingEnabled: false }, null, 2));
  process.exit(0);
}
const blockers: string[] = [], source = await releaseSourceSha256();
let binary: Buffer | null = null;
try { binary = await readFile(binaryPath); } catch { blockers.push('Mainnet-v2 SBF binary is missing. Run npm run build:programs.'); }
const sha = binary ? digest(binary) : null;
const runtime = await optional<{ passed: boolean; binarySha256: string; sourceSha256: string }>('.mainnet/svm-result.json');
const checks = await optional<{ passed: boolean; binarySha256: string; sourceSha256: string }>('.mainnet/release-checks.json');
const testsPassed = !!binary && runtime?.passed === true && runtime.binarySha256 === sha && runtime.sourceSha256 === source && checks?.passed === true && checks.sourceSha256 === source && checks.binarySha256 === sha;
if (!testsPassed) blockers.push('All release checks must pass against this exact Mainnet binary and source. Run npm run verify:release.');
const binaryDomainMatches = !!binary && binary.includes(Buffer.from(context.tag)) && binary.includes(Buffer.from(context.domain));
if (binary && !binaryDomainMatches) blockers.push('Binary lacks the Mainnet-v2 authorization domain.');
type Review = { reviewer: string; reportUrl: string; reportSha256: string; sourceSha256: string; binarySha256: string; authorizationProfile: string; programId: string; conclusion: string };
const review = await optional<Review>('.mainnet/security-review.json');
let reviewPassed = false;
if (review && typeof review.reviewer === 'string' && review.reviewer.trim() && review.conclusion === 'approved' && review.authorizationProfile === 'mainnet-v2' && review.programId === manifest.programId && review.sourceSha256 === source && review.binarySha256 === sha && /^https:\/\//.test(review.reportUrl) && /^[0-9a-f]{64}$/.test(review.reportSha256)) {
  const response = await fetch(review.reportUrl, { signal: AbortSignal.timeout(15000) });
  reviewPassed = response.ok && digest(new Uint8Array(await response.arrayBuffer())) === review.reportSha256;
}
const experimentalLaunch = await optional<ExperimentalLaunch>('.mainnet/experimental-launch.json');
const experimentalAuthorized = experimentalLaunchMatches(experimentalLaunch, manifest.programId, source, sha);
if (!reviewPassed && !experimentalAuthorized) blockers.push('No independently supplied security review or owner-authorized experimental release covers this exact Mainnet source/binary.');
const rpc = new Connection(MAINNET_DEPLOY_RPC, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) });
let genesis: string | null = null, balance: number | null = null, programExists: boolean | null = null, rents: { program: number; programData: number; buffer: number; minimumFeePayerLamports: number } | null = null;
try {
  genesis = await rpc.getGenesisHash(); assertNetwork(genesis, 'mainnet-v2');
  balance = await rpc.getBalance(payer.publicKey, 'finalized');
  const account = await rpc.getAccountInfo(programKey.publicKey, 'finalized'); programExists = !!account;
  if (binary) {
    const programRent = await rpc.getMinimumBalanceForRentExemption(36, 'finalized');
    const dataRent = await rpc.getMinimumBalanceForRentExemption(45 + binary.length, 'finalized');
    const bufferRent = await rpc.getMinimumBalanceForRentExemption(37 + binary.length, 'finalized');
    rents = { program: programRent, programData: dataRent, buffer: bufferRent, minimumFeePayerLamports: programRent + dataRent + bufferRent + 1_000_000 };
    if (balance < rents.minimumFeePayerLamports && !account) blockers.push(`Dedicated Mainnet fee payer has ${balance} lamports; preparation estimates at least ${rents.minimumFeePayerLamports} lamports including temporary buffer and fee allowance. No funds were requested or moved.`);
  }
  if (!account) blockers.push(`Mainnet program account ${manifest.programId} does not exist.`);
  else {
    const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
    if (!binary || !testsPassed || !account.executable || !account.owner.equals(loader) || account.data.length !== 36 || account.data.readUInt32LE(0) !== 2) throw Error('Invalid executable program or untested binary');
    const pd = new PublicKey(account.data.subarray(4)), data = await rpc.getAccountInfo(pd, 'finalized');
    if (!data || !data.owner.equals(loader) || data.data.readUInt32LE(0) !== 3 || data.data[12] !== 0) throw Error('Mainnet program must be immutable with no upgrade authority');
    const deployment = await json<{ signature: string }>('.mainnet/deployment-result.json');
    const receipt = await rpc.getTransaction(deployment.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    const slot = Number(data.data.readBigUInt64LE(4));
    if (!receipt?.meta || receipt.meta.err || receipt.slot !== slot || !receipt.transaction.message.getAccountKeys().keySegments().flat().some(k => k.equals(pd))) throw Error('Deployment transaction does not match finalized ProgramData slot');
    const candidate: Deployment = { ...manifest, verified: true, binarySha256: sha, binarySize: binary.length, programData: pd.toBase58(), upgradeAuthority: null, deploymentSlot: slot, deploymentSignature: deployment.signature };
    const verifier = new SolanaChain(candidate); await verifier.validateDeployment();
    manifest = candidate;
  }
} catch (error) { manifest.verified = false; blockers.push(`Read-only Mainnet verification failed: ${(error as Error).message}`); }
manifest.mainnetRelease = { status: !reviewPassed && !experimentalAuthorized ? 'review-required' : !manifest.verified ? 'deployment-required' : 'smoke-test-required', compiledTestsPassed: testsPassed, sourceSha256: source, securityReview: { status: reviewPassed ? 'verified' : 'pending', reportUrl: reviewPassed ? review!.reportUrl : null, reportSha256: reviewPassed ? review!.reportSha256 : null, reviewedBinarySha256: reviewPassed ? sha : null, reviewedSourceSha256: reviewPassed ? source : null }, ...(experimentalAuthorized ? { experimentalLaunch: experimentalLaunch! } : {}), smoke: manifest.mainnetRelease?.smoke ?? null };
let lifecycleVerified = false;
if (manifest.verified && testsPassed && manifest.mainnetRelease.smoke) {
  try { await new SolanaChain(manifest).inspectMainnetLifecycle(manifest.mainnetRelease.smoke); lifecycleVerified = true; }
  catch (error) { blockers.push(`Finalized owner lifecycle verification failed: ${(error as Error).message}`); }
}
if (manifest.verified && (reviewPassed || experimentalAuthorized) && testsPassed && lifecycleVerified) {
  manifest.mainnetRelease.status = reviewPassed ? 'ready' : 'experimental-ready';
  try { await new SolanaChain(manifest).validate(); }
  catch (error) { manifest.mainnetRelease.status = 'smoke-test-required'; blockers.push((error as Error).message); }
}
if (!lifecycleVerified) blockers.push('Finalized Mainnet create/deposit/partial/full rotation + clean-store recovery evidence is absent or incomplete.');
if (manifest.verified) manifest.note = manifest.mainnetRelease.status === 'experimental-ready' ? 'Immutable Mainnet-v2 program and finalized lifecycle verified. Owner-authorized experimental release. Independent security review pending.' : reviewPassed ? 'Immutable Mainnet-v2 program verified against the exact compiled build. Public funding requires the complete release gate.' : 'Immutable Mainnet-v2 program verified against the exact compiled build. Independent review is pending and public funding is disabled.';
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
let deploymentPrerequisitesPassed = false;
try { assertMainnetDeployment({ genesis, programAccountExists: programExists, exactBuildTestsPassed: testsPassed, binaryDomainMatches, balanceLamports: balance, minimumLamports: rents?.minimumFeePayerLamports ?? null }); deploymentPrerequisitesPassed = true; }
catch (error) { if (forDeployment) blockers.push((error as Error).message); }
const fundingEnabled = ['ready', 'experimental-ready'].includes(manifest.mainnetRelease.status);
const result = { checkedAt: new Date().toISOString(), mode, rpcEndpoint: MAINNET_DEPLOY_RPC, rpcGenesis: genesis, authorizationProfile: 'mainnet-v2', programId: manifest.programId, programAccountExists: programExists, programDeploymentVerified: manifest.verified, feePayer: payer.publicKey.toBase58(), feePayerLamports: balance, requiredUpgradePolicy: 'immutable', binaryPath, binarySha256: sha, binarySize: binary?.length ?? null, sourceSha256: source, exactBuildCompiledTestsPassed: testsPassed, independentReviewVerified: reviewPassed, experimentalLaunchAuthorized: experimentalAuthorized, lifecycleVerified, deploymentPrerequisitesPassed, deploymentRequiresIndependentReview: false, publicFundingRequiresIndependentReview: !experimentalAuthorized, rents, releaseStatus: manifest.mainnetRelease.status, fundingEnabled, transactionsSubmitted: 0, blockers };
await writeFile('docs/mainnet-preflight.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
if (forDeployment && !deploymentPrerequisitesPassed) process.exitCode = 1;
else if (['verify', 'release'].includes(mode) && (!manifest.verified || mode === 'release' && !fundingEnabled)) process.exitCode = 1;
