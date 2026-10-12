import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { releaseSourceSha256 } from './release-source.ts';
const binaries = ['program/target/deploy/shell_vault.so', 'protocol/target/deploy/shell_protocol.so', 'program/target/deploy/mainnet/shell_vault.so'];
const bytes = await Promise.all(binaries.map(f => readFile(f)));
const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-concurrency=1', 'tests/svm.integration.ts', 'tests/protocol.svm.integration.ts'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const idl = JSON.parse(await readFile('src/protocol/idl.json', 'utf8'));
await mkdir('.dev', { recursive: true });
for (const [i, name] of ['svm-result', 'protocol-svm-result'].entries()) {
  await writeFile(`.dev/${name}.json`, JSON.stringify({ passed: true, binarySha256: createHash('sha256').update(bytes[i]).digest('hex'), binarySize: bytes[i].length,
    ...(i === 1 ? { idlSha256: createHash('sha256').update(JSON.stringify(idl)).digest('hex') } : {}), runtime: 'LiteSVM 1.6.0', agave: '4.3.0', platformTools: 'v1.57', completedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}
await mkdir('.mainnet', { recursive: true, mode: 0o700 });
await writeFile('.mainnet/svm-result.json', JSON.stringify({ passed: true, authorizationProfile: 'mainnet-v2', sourceSha256: await releaseSourceSha256(), binarySha256: createHash('sha256').update(bytes[2]).digest('hex'), binarySize: bytes[2].length, runtime: 'LiteSVM 1.6.0', agave: '4.3.0', platformTools: 'v1.57', completedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
