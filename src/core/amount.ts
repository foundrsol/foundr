export const LAMPORTS = 1_000_000_000n;
export function parseSol(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)) throw Error('Enter SOL with at most 9 decimal places. No rounding is applied.');
  const [whole, decimal = ''] = value.split('.');
  const n = BigInt(whole) * LAMPORTS + BigInt(decimal.padEnd(9, '0'));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Amount exceeds this prototype’s safe RPC range');
  return n;
}
export function formatSol(value: bigint): string {
  if (value < 0n) return '-' + formatSol(-value);
  return `${value / LAMPORTS}.${(value % LAMPORTS).toString().padStart(9, '0')}`;
}
export function checkFunds(balance: bigint, amount: bigint, rent: bigint, fees: bigint): void {
  if (amount <= 0n) throw Error('Amount must be positive');
  if (balance < amount + rent + fees) throw Error('Insufficient SOL for amount, account rent, and transaction fees');
}
