import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Deployment, MainnetRelease } from '../src/solana/chain.ts';
import { EXPERIMENTAL_DISCLOSURE, experimentalLaunchMatches, mainnetReleaseAuthorized, type ExperimentalLaunch } from '../src/solana/release.ts';

const reservation = JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment;
const source = 'ab'.repeat(32), binary = 'cd'.repeat(32);
const authorization: ExperimentalLaunch = { mode: 'owner-authorized-experimental', authorizationProfile: 'mainnet-v2', programId: reservation.programId, sourceSha256: source, binarySha256: binary, authorizedAt: '2026-10-11T00:00:00.000Z', disclosure: EXPERIMENTAL_DISCLOSURE };
function deployment(): Deployment {
  return { ...reservation, binarySha256: binary, mainnetRelease: { status: 'experimental-ready', sourceSha256: source, compiledTestsPassed: true, experimentalLaunch: { ...authorization }, securityReview: { status: 'pending', reportUrl: null, reportSha256: null, reviewedSourceSha256: null, reviewedBinarySha256: null }, smoke: structuredClone(reservation.mainnetRelease!.smoke) } };
}
test('experimental authorization must bind the exact source, binary, deployment and factual disclosure', () => {
  assert.equal(experimentalLaunchMatches(authorization, reservation.programId, source, binary), true);
  for (const changed of [ { sourceSha256: 'ef'.repeat(32) }, { binarySha256: source }, { programId: 'unexpected' }, { authorizationProfile: 'devnet-v1' }, { mode: 'automatic' }, { disclosure: 'Audited' }, { authorizedAt: 'invalid' } ]) {
    assert.equal(experimentalLaunchMatches({ ...authorization, ...changed } as ExperimentalLaunch, reservation.programId, source, binary), false);
  }
  assert.equal(experimentalLaunchMatches(null, reservation.programId, source, binary), false);
});
test('experimental policy does not fabricate a review or bypass build and lifecycle prerequisites', () => {
  const d = deployment(); assert.equal(mainnetReleaseAuthorized(d), true);
  assert.equal(d.mainnetRelease!.securityReview.status, 'pending');
  for (const changed of [ { compiledTestsPassed: false }, { smoke: null }, { status: 'ready' }, { experimentalLaunch: undefined }, { sourceSha256: 'ef'.repeat(32) } ]) {
    assert.equal(mainnetReleaseAuthorized({ ...d, mainnetRelease: { ...d.mainnetRelease!, ...changed } as MainnetRelease }), false);
  }
  assert.equal(mainnetReleaseAuthorized({ ...d, mainnetRelease: { ...d.mainnetRelease!, securityReview: { ...d.mainnetRelease!.securityReview, status: 'verified' } } }), false);
  assert.equal(mainnetReleaseAuthorized({ ...d, mainnetRelease: { ...d.mainnetRelease!, securityReview: { ...d.mainnetRelease!.securityReview, reportUrl: 'https://fake.example/review' } } }), false);
});
test('reviewed releases still require their own exact-build review; an experimental flag cannot replace it', () => {
  const d = deployment(); d.mainnetRelease!.status = 'ready'; assert.equal(mainnetReleaseAuthorized(d), false);
  d.mainnetRelease!.securityReview = { status: 'verified', reportUrl: 'https://review.example/report', reportSha256: 'ef'.repeat(32), reviewedBinarySha256: binary, reviewedSourceSha256: source };
  assert.equal(mainnetReleaseAuthorized(d), true);
  d.mainnetRelease!.securityReview.reviewedSourceSha256 = binary; assert.equal(mainnetReleaseAuthorized(d), false);
});
