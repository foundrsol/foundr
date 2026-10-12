import test from 'node:test';
import assert from 'node:assert/strict';
import { protocolFee, splitRevenue, testRules, swapQuote, parseUnits, formatUnits, U64_MAX, validateRules } from '../src/protocol/fees.ts';
test('fee previews use exact lamports, configured rates, ceiling and an absolute cap', () => {
  const rules = testRules(); assert.equal(protocolFee(1n, 0, rules), 0n); assert.equal(protocolFee(1n, 1, rules), 1n);
  assert.equal(protocolFee(1_000_000_000n, 1, rules), 2_500_000n); assert.equal(protocolFee(1_000_000_000n, 2, rules), 1_000_000n); assert.equal(protocolFee(1_000_000_000n, 3, rules), 3_000_000n); assert.equal(protocolFee(1_000_000_000n, 4, rules), 4_000_000n);
  assert.equal(protocolFee(U64_MAX, 4, rules), rules.maxFeeNative); assert.throws(() => protocolFee(U64_MAX + 1n, 1, rules));
  assert.throws(() => protocolFee(0n, 1, rules)); assert.throws(() => validateRules({ ...rules, buybackBps: 10001 }));
});
test('revenue allocation conserves every unit and carries integer dust across payments', () => {
  let carry = 0, buyback = 0n, treasury = 0n;
  for (let i = 0; i < 101; i++) { const r = splitRevenue(1n, 8000, carry); carry = r.carry; buyback += r.buyback; treasury += r.treasury; }
  assert.equal(buyback, 80n); assert.equal(treasury, 21n); assert.equal(carry, 8000); assert.equal(buyback + treasury, 101n);
  const last = splitRevenue(4n, 8000, carry); assert.equal(buyback + last.buyback, 84n); assert.equal(last.carry, 0);
});
test('keeper pool quotes enforce real liquidity, impact, size and minimum output', () => {
  const r = testRules(); const q = swapQuote(700_000n, 10_000_000_000n, 1_000_000_000_000n, r, true);
  assert.ok(q.output > q.minimumOut && q.minimumOut > 0n);
  assert.throws(() => swapQuote(700_000n, 0n, 1_000_000n, r, true), /liquidity/);
  assert.throws(() => swapQuote(700_000n, 1n, 1_000_000n, r, true), /liquidity/);
  assert.throws(() => swapQuote(10_000_001n, 10_000_000_000n, 1_000_000_000_000n, r, true), /limit/);
  assert.throws(() => swapQuote(10_000_000n, 1_000_000_000n, 1_000_000_000_000n, { ...r, maxImpactBps: 1 }, true), /impact/);
});
test('SPL precision never rounds, truncates, or accepts floating-point exponent notation', () => {
  assert.equal(parseUnits('0.000001', 6), 1n); assert.equal(formatUnits(1234567n, 6), '1.234567'); assert.equal(formatUnits(5n, 0), '5');
  for (const text of ['0.0000001', '1e3', '-1', '01', '1.']) assert.throws(() => parseUnits(text, 6));
  assert.throws(() => parseUnits('18446744073709551616', 0));
});
