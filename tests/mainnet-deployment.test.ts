import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAINNET_GENESIS, DEVNET_GENESIS } from '../src/core/protocol.ts';
import { assertMainnetDeployment, assertOwnerSmokeBuild, type DeploymentFacts } from '../scripts/mainnet-deployment.ts';
import type { Deployment } from '../src/solana/chain.ts';
import { FileStore } from '../scripts/file-store.ts';

test('owner-funded deployment requires verified network, absent account, exact checks and rent budget', () => {
  const valid: DeploymentFacts = { genesis: MAINNET_GENESIS, programAccountExists: false, exactBuildTestsPassed: true, binaryDomainMatches: true, balanceLamports: 300_000_000, minimumLamports: 252_917_200 };
  assert.doesNotThrow(() => assertMainnetDeployment(valid));
  for (const changed of [{ genesis: null }, { genesis: DEVNET_GENESIS }, { programAccountExists: null }, { programAccountExists: true }, { exactBuildTestsPassed: false }, { binaryDomainMatches: false }, { balanceLamports: null }, { minimumLamports: null }, { minimumLamports: 0 }, { balanceLamports: 252_917_199 }, { balanceLamports: Number.NaN }, { balanceLamports: 300_000_000.5 }]) assert.throws(() => assertMainnetDeployment({ ...valid, ...changed }), /requires|insufficient/);
});

test('bounded owner smoke permits a pending review but never accepts unverified or changed builds', async () => {
  const reservation = JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment;
  const source = 'ab'.repeat(32), binary = 'cd'.repeat(32), check = { passed: true, sourceSha256: source, binarySha256: binary };
  const manifest: Deployment = { ...reservation, verified: true, upgradeAuthority: null, binarySha256: binary, mainnetRelease: { status: 'review-required', sourceSha256: source, compiledTestsPassed: true, securityReview: { status: 'pending', reportUrl: null, reportSha256: null, reviewedSourceSha256: null, reviewedBinarySha256: null }, smoke: null } };
  assert.doesNotThrow(() => assertOwnerSmokeBuild(manifest, source, check, check));
  assert.equal(manifest.mainnetRelease!.status, 'review-required');
  assert.equal(manifest.mainnetRelease!.securityReview.status, 'pending');
  for (const changed of [{ verified: false }, { upgradeAuthority: reservation.programId }, { cluster: 'devnet' }, { genesis: DEVNET_GENESIS }, { authorizationProfile: 'devnet-v1' as const }, { binarySha256: 'ef'.repeat(32) }]) assert.throws(() => assertOwnerSmokeBuild({ ...manifest, ...changed }, source, check, check));
  for (const changed of [{ passed: false }, { sourceSha256: 'ef'.repeat(32) }, { binarySha256: 'ef'.repeat(32) }]) {
    assert.throws(() => assertOwnerSmokeBuild(manifest, source, { ...check, ...changed }, check));
    assert.throws(() => assertOwnerSmokeBuild(manifest, source, check, { ...check, ...changed }));
  }
});

test('owner smoke journal survives a fresh store and refuses concurrent writers before replacing encrypted state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shell-owner-journal-')), file = join(directory, 'identity.json'), password = 'owner-journal-test-password-123';
  try {
    const journal = new FileStore(file), state = { phase: 'signed', boundOperation: 'same-operation-after-restart', raw: 'persist-before-submission' };
    await journal.exclusive(password, async session => {
      await session.save(state);
      await assert.rejects(new FileStore(file).exclusive(password, async other => { await other.save({ phase: 'different' }); }), { code: 'EEXIST' });
    });
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.ok(!(await readFile(file, 'utf8')).includes(state.boundOperation));
    const loaded = await new FileStore(file).exclusive(password, session => session.load<typeof state>());
    assert.deepEqual(loaded, state);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
