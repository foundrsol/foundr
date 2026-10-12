import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
try { await access('program/target/deploy/shell_vault.so'); } catch { throw Error('Build the real SBF program first: cargo build-sbf --manifest-path program/Cargo.toml'); }
const child = spawnSync(process.execPath, ['--test', '--test-isolation=none', 'tests/svm.integration.ts'], { stdio: 'inherit' });
process.exit(child.status ?? 1);
