import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { releaseSourceSha256 } from './release-source.ts';
// Produces a release record only after every required stage succeeds. Running
// this workflow never deploys, funds a live vault, or enables funding by itself.
const commands = ['verify:upstream', 'typecheck', 'typecheck:tools', 'test', 'test:programs', 'test:browser'];
for (const command of commands) {
  const result = spawnSync('npm', ['run', command], { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const build = spawnSync('npm', ['run', 'build', '--', '--webpack'], { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
if (build.status !== 0) process.exit(build.status ?? 1);
const runtime = JSON.parse(await readFile('.mainnet/svm-result.json', 'utf8'));
const sourceSha256 = await releaseSourceSha256();
if (sourceSha256 !== runtime.sourceSha256 || runtime.passed !== true) throw Error('Release source changed while checks were running. Stop and rerun verification.');
await writeFile('.mainnet/release-checks.json', JSON.stringify({ passed: true, sourceSha256, binarySha256: runtime.binarySha256, upstreamVerified: true, frontendTypecheckPassed: true, toolsTypecheckPassed: true, cryptoAndDurabilityTestsPassed: true, compiledTestsPassed: true, browserTestsPassed: true, productionBuildPassed: true, completedAt: new Date().toISOString(), liveNetworkTransactionsSubmitted: 0 }, null, 2) + '\n', { mode: 0o600 });
console.log('Release implementation checks passed. Immutable deployment, explicit release policy and finalized lifecycle verification are separate checks.');
