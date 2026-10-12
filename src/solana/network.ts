import { DEVNET_GENESIS, MAINNET_GENESIS, authorizationContext, type AuthorizationProfile } from '../core/protocol.ts';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
// The official Mainnet endpoint rejects browser Origin headers (HTTP 403).
// Pin a browser-accessible provider explicitly; do not disguise an endpoint
// switch or infer the extension's selected cluster. Devnet remains official.
export const MAINNET_RPC = 'https://solana-rpc.publicnode.com';
export const MAINNET_DEPLOY_RPC = 'https://api.mainnet-beta.solana.com';
export const MAINNET_RPC_RELAY_PATH = '/api/mainnet-rpc';
export const rpcForProfile = (profile: AuthorizationProfile) => { authorizationContext(profile); return profile === 'mainnet-v2' ? MAINNET_RPC : DEVNET_RPC; };
// HTTPS production pages use a fixed same-origin Vercel rewrite. Local HTTP
// development and CLI checks still contact the explicit provider directly.
// This changes transport only: full genesis and program checks still run.
export function rpcTransportForProfile(profile: AuthorizationProfile): string {
  const provider = rpcForProfile(profile);
  if (profile === 'mainnet-v2' && typeof window !== 'undefined' && window.location.protocol === 'https:') return new URL(MAINNET_RPC_RELAY_PATH, window.location.origin).href;
  return provider;
}
export type DevnetDiagnostics = {
  rpcEndpoint: string; rpcTransportEndpoint: string; expectedGenesis: string; rpcGenesis: string | null;
  rpcStatus: 'unchecked' | 'checking' | 'verified' | 'mismatch' | 'unavailable';
  rpcCause: string | null; walletPublicKey: string | null; walletProvider: string | null;
  walletNetwork: 'not exposed; not verified'; programId: string; manifestVerified: boolean;
  deploymentStatus: 'unchecked' | 'checking' | 'missing' | 'unverified' | 'invalid' | 'verified' | 'unavailable';
  deploymentCause: string | null;
};
export const initialDiagnostics = (programId: string, manifestVerified: boolean, profile: AuthorizationProfile = 'devnet-v1'): DevnetDiagnostics => ({
  rpcEndpoint: rpcForProfile(profile), rpcTransportEndpoint: rpcTransportForProfile(profile), expectedGenesis: authorizationContext(profile).genesis, rpcGenesis: null,
  rpcStatus: 'unchecked', rpcCause: null, walletPublicKey: null, walletProvider: null,
  walletNetwork: 'not exposed; not verified', programId, manifestVerified,
  deploymentStatus: 'unchecked', deploymentCause: null,
});
export function fundingDeploymentVerified(d: DevnetDiagnostics | null): boolean {
  return !!d && ((d.rpcEndpoint === DEVNET_RPC && d.rpcTransportEndpoint === rpcTransportForProfile('devnet-v1') && d.expectedGenesis === DEVNET_GENESIS) || (d.rpcEndpoint === MAINNET_RPC && d.rpcTransportEndpoint === rpcTransportForProfile('mainnet-v2') && d.expectedGenesis === MAINNET_GENESIS)) && d.rpcGenesis === d.expectedGenesis && d.rpcStatus === 'verified' && d.manifestVerified && d.deploymentStatus === 'verified';
}
// This whitelist is the complete logging surface. Never pass identity, errors,
// transactions, recovery packages, passwords, or private-key objects here.
export function publicDiagnostics(d: DevnetDiagnostics): DevnetDiagnostics {
  return { rpcEndpoint: d.rpcEndpoint, rpcTransportEndpoint: d.rpcTransportEndpoint, expectedGenesis: d.expectedGenesis, rpcGenesis: d.rpcGenesis, rpcStatus: d.rpcStatus, rpcCause: d.rpcCause,
    walletPublicKey: d.walletPublicKey, walletProvider: d.walletProvider, walletNetwork: d.walletNetwork, programId: d.programId,
    manifestVerified: d.manifestVerified, deploymentStatus: d.deploymentStatus, deploymentCause: d.deploymentCause };
}
