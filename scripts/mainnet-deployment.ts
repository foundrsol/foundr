import { MAINNET_GENESIS } from '../src/core/protocol.ts';
import type { Deployment } from '../src/solana/chain.ts';

export type BuildCheck = { passed: boolean; sourceSha256: string; binarySha256: string };
export type DeploymentFacts = {
  genesis: string | null; programAccountExists: boolean | null;
  exactBuildTestsPassed: boolean; binaryDomainMatches: boolean;
  balanceLamports: number | null; minimumLamports: number | null;
};

// Deploying an owner-funded, explicitly unaudited build is distinct from
// permitting public deposits. SolanaChain.validate() retains the review gate.
export function assertMainnetDeployment(facts: DeploymentFacts): void {
  if (facts.genesis !== MAINNET_GENESIS) throw Error('Deployment requires the verified official Mainnet genesis.');
  if (facts.programAccountExists !== false) throw Error('Deployment requires a confirmed absent program account; existing or unknown outcomes must be reconciled.');
  if (!facts.exactBuildTestsPassed || !facts.binaryDomainMatches) throw Error('Deployment requires passing exact-source release checks and the Mainnet-v2 binary domain.');
  if (!Number.isSafeInteger(facts.balanceLamports) || !Number.isSafeInteger(facts.minimumLamports) || facts.minimumLamports! <= 0 || facts.balanceLamports! < facts.minimumLamports!) throw Error('Deployment fee-payer balance or rent budget is insufficient or unverified.');
}

export function assertOwnerSmokeBuild(manifest: Deployment, source: string, runtime: BuildCheck, checks: BuildCheck): void {
  if (manifest.authorizationProfile !== 'mainnet-v2' || manifest.cluster !== 'mainnet-beta' || manifest.genesis !== MAINNET_GENESIS || !manifest.verified || manifest.upgradeAuthority !== null) throw Error('Owner smoke test requires a verified immutable Mainnet-v2 deployment. Nothing was submitted.');
  if (!/^[0-9a-f]{64}$/.test(source) || !/^[0-9a-f]{64}$/.test(manifest.binarySha256 ?? '') || manifest.mainnetRelease?.sourceSha256 !== source || manifest.mainnetRelease.compiledTestsPassed !== true || [runtime, checks].some(check => check?.passed !== true || check.sourceSha256 !== source || check.binarySha256 !== manifest.binarySha256)) throw Error('Owner smoke test requires release checks for this exact source and deployed binary. Nothing was submitted.');
}
