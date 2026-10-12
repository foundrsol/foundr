import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const solanaRequire = createRequire(require.resolve('@solana/buffer-layout-utils'));

test('Solana integer conversion uses the pinned non-native fork and accepts buffers longer than 32 bytes safely', () => {
  const pkg = solanaRequire('bigint-buffer/package.json');
  assert.equal(pkg.name, '@exodus/bigint-buffer');
  assert.equal(pkg.version, '1.1.5-exodus.1');
  assert.equal(pkg.scripts.install, undefined);
  assert.equal(pkg.dependencies, undefined);
  const { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE } = solanaRequire('bigint-buffer');
  assert.equal(toBigIntLE(Buffer.alloc(0)), 0n);
  assert.equal(toBigIntBE(Buffer.alloc(0)), 0n);
  for (const width of [1, 7, 8, 32, 33, 65, 513]) {
    const bytes = Buffer.from(Array.from({ length: width }, (_, j) => (j * 17 + 1) % 256));
    const original = Buffer.from(bytes);
    let expected = 0n;
    for (const b of bytes) expected = (expected << 8n) | BigInt(b);
    assert.equal(toBigIntBE(bytes), expected);
    assert.equal(toBigIntLE(Buffer.from(bytes).reverse()), expected);
    assert.deepEqual(toBufferBE(expected, width), bytes);
    assert.deepEqual(toBufferLE(expected, width), Buffer.from(bytes).reverse());
    assert.deepEqual(bytes, original);
  }
});

test('the actual Solana SDK entrypoints do not load the remaining vulnerable streaming parser', () => {
  // Use a fresh Node process: unrelated test imports cannot mask this boundary.
  const result = execFileSync(process.execPath, ['-e', `
    require('@solana/web3.js');
    require('@anchor-lang/core');
    require('@solana/spl-token');
    process.stdout.write(JSON.stringify(Object.keys(require.cache).filter(x => x.includes('/stream-json/'))));
  `], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), []);
});
