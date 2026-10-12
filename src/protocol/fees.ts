// Integer calculations shared by previews and keeper quote validation.
// On-chain enforcement remains authoritative. Never use floating point amounts.
export type Service = 0 | 1 | 2 | 3 | 4;
export type FeeRules = {
  // Service order: advanced operation, protected transfer, rotation.
  ratesBps: [number, number, number]; buybackBps: number;
  maxFeeNative: bigint; maxFeeSpl: bigint; subscriptionPrice: bigint;
  maxImpactBps: number; maxSlippageBps: number;
  maxSettleNative: bigint; maxSettleSpl: bigint;
  minLiquidityNative: bigint; minLiquiditySpl: bigint;
  minimumStake: bigint; operatorLockSeconds: number;
};
export const U64_MAX = (1n << 64n) - 1n;
export function unsigned(value: bigint): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw Error('Amount is outside u64 range');
  return value;
}
export function validateRules(r: FeeRules): void {
  for (const n of [...r.ratesBps, r.buybackBps, r.maxImpactBps, r.maxSlippageBps, r.operatorLockSeconds]) if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid fee configuration');
  if (r.ratesBps.length !== 3 || r.ratesBps.some(n => n > 100) || r.buybackBps > 10000 || r.maxImpactBps > 500 || r.maxSlippageBps > 200 || r.operatorLockSeconds < 3600 || r.operatorLockSeconds > 7_776_000) throw Error('Invalid fee configuration');
  for (const n of [r.maxFeeNative, r.maxFeeSpl, r.subscriptionPrice, r.maxSettleNative, r.maxSettleSpl, r.minLiquidityNative, r.minLiquiditySpl, r.minimumStake]) if (unsigned(n) === 0n) throw Error('Configuration amounts must be positive');
  if (r.subscriptionPrice > r.maxFeeSpl) throw Error('Subscription exceeds maximum fee');
}
export function protocolFee(amount: bigint, service: Service, r: FeeRules): bigint {
  unsigned(amount); validateRules(r); if (amount <= 0n) throw Error('Amount must be positive');
  if (service === 0) return 0n;
  const rate = service === 4 ? r.ratesBps[1] + r.ratesBps[2] : r.ratesBps[service - 1];
  if (rate === undefined) throw Error('Unknown security service');
  const fee = (amount * BigInt(rate) + 9999n) / 10000n;
  return fee < r.maxFeeNative ? fee : r.maxFeeNative;
}
export function splitRevenue(fee: bigint, buybackBps: number, carry = 0): { buyback: bigint; treasury: bigint; carry: number } {
  unsigned(fee);
  if (!Number.isInteger(buybackBps) || buybackBps < 0 || buybackBps > 10000 || !Number.isInteger(carry) || carry < 0 || carry >= 10000) throw Error('Invalid revenue split');
  const scaled = fee * BigInt(buybackBps) + BigInt(carry), buyback = scaled / 10000n;
  return { buyback, treasury: fee - buyback, carry: Number(scaled % 10000n) };
}
export function swapQuote(amount: bigint, quoteReserve: bigint, shellReserve: bigint, r: FeeRules, native: boolean): { output: bigint; minimumOut: bigint; impactBps: bigint } {
  validateRules(r); unsigned(amount); unsigned(quoteReserve); unsigned(shellReserve);
  if (amount === 0n || amount > (native ? r.maxSettleNative : r.maxSettleSpl) || quoteReserve < (native ? r.minLiquidityNative : r.minLiquiditySpl) || shellReserve === 0n) throw Error('Insufficient real pool liquidity or settlement limit exceeded');
  const input = amount * 9970n; // Controlled test pool: disclosed 30 bps liquidity fee.
  const output = input * shellReserve / (quoteReserve * 10000n + input);
  const ideal = input * shellReserve / (quoteReserve * 10000n);
  if (!ideal || !output || (ideal - output) * 10000n > ideal * BigInt(r.maxImpactBps)) throw Error('Price impact exceeds configured limit');
  return { output, minimumOut: (output * BigInt(10000 - r.maxSlippageBps) + 9999n) / 10000n, impactBps: (ideal - output) * 10000n / ideal };
}
export function formatUnits(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw Error('Unsupported decimals');
  if (amount < 0n) return '-' + formatUnits(-amount, decimals);
  const divisor = 10n ** BigInt(decimals);
  return decimals === 0 ? amount.toString() : `${amount / divisor}.${(amount % divisor).toString().padStart(decimals, '0')}`;
}
export function parseUnits(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) throw Error('Enter a precise positive token amount');
  const [whole, fraction = ''] = text.split('.'); if (fraction.length > decimals) throw Error('Too many decimal places; no rounding is applied');
  return unsigned(BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0'));
}
// Defaults for disposable test assets only. Deployed config is read live.
export function testRules(shellDecimals = 6): FeeRules {
  return { ratesBps: [25, 10, 30], buybackBps: 8000, maxFeeNative: 10_000_000n, maxFeeSpl: 20_000_000n,
    subscriptionPrice: 10_000_000n, maxImpactBps: 200, maxSlippageBps: 50,
    maxSettleNative: 10_000_000n, maxSettleSpl: 10_000_000n,
    minLiquidityNative: 1_000_000_000n, minLiquiditySpl: 1_000_000_000n,
    minimumStake: 100n * 10n ** BigInt(shellDecimals), operatorLockSeconds: 604800 };
}
