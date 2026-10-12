import type { Deployment } from './chain.ts';

export const EXPERIMENTAL_DISCLOSURE = 'Experimental vault authorization. Independent security review pending.';
export type ExperimentalLaunch = {
  mode: 'owner-authorized-experimental';
  authorizationProfile: 'mainnet-v2';
  programId: string;
  sourceSha256: string;
  binarySha256: string;
  authorizedAt: string;
  disclosure: typeof EXPERIMENTAL_DISCLOSURE;
};

// A publisher's release-policy declaration, not a spending authorization or
// an independent review. Every program/account/lifecycle check still runs.
export function experimentalLaunchMatches(value: ExperimentalLaunch | undefined | null, programId: string, source: string | null, binary: string | null): boolean {
  return !!value && value.mode === 'owner-authorized-experimental' && value.authorizationProfile === 'mainnet-v2'
    && value.programId === programId && value.sourceSha256 === source && value.binarySha256 === binary
    && /^[0-9a-f]{64}$/.test(source ?? '') && /^[0-9a-f]{64}$/.test(binary ?? '')
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.authorizedAt)
    && Number.isFinite(Date.parse(value.authorizedAt)) && value.disclosure === EXPERIMENTAL_DISCLOSURE;
}

export function mainnetReleaseAuthorized(deployment: Deployment): boolean {
  const release = deployment.mainnetRelease;
  if (!release || release.compiledTestsPassed !== true || !/^[0-9a-f]{64}$/.test(release.sourceSha256 ?? '') || !release.smoke) return false;
  const review = release.securityReview;
  if (!review) return false;
  if (release.status === 'ready') return review.status === 'verified'
    && review.reviewedBinarySha256 === deployment.binarySha256 && review.reviewedSourceSha256 === release.sourceSha256
    && /^https:\/\//.test(review.reportUrl ?? '') && /^[0-9a-f]{64}$/.test(review.reportSha256 ?? '');
  if (release.status !== 'experimental-ready') return false;
  return review.status === 'pending' && review.reportUrl === null && review.reportSha256 === null
    && review.reviewedBinarySha256 === null && review.reviewedSourceSha256 === null
    && experimentalLaunchMatches(release.experimentalLaunch, deployment.programId, release.sourceSha256, deployment.binarySha256);
}
