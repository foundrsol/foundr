import type { AuthorizationProfile } from './protocol.ts';

// Application activation fee, approved by the operator. It is paid by the
// connected wallet, never taken from vault funds or automatic rotations.
export const PLATFORM_FEE_LAMPORTS = 10_000_000n;
export const PLATFORM_FEE_RECIPIENT = '45Vxy36SWNd1DrMZWqn1QkVhRgCqfhHPB9uLnw4xqqgy';

export function activationPlatformFee(profile: AuthorizationProfile): bigint {
  if (profile === 'mainnet-v2') return PLATFORM_FEE_LAMPORTS;
  if (profile === 'devnet-v1') return 0n;
  throw Error('Unsupported activation fee network');
}
