import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Stable digest of the implementation being reviewed. Generated manifests,
// evidence, binaries, build output and private identities are excluded.
export async function releaseSourceSha256(): Promise<string> {
  const files = ['package.json', 'package-lock.json', 'source-lock.json', 'program/Cargo.toml', 'program/Cargo.lock', 'next.config.ts', 'vercel.json', 'tsconfig.json', 'tsconfig.tools.json'];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory() && !['target', '.git', 'node_modules', '.cache'].includes(entry.name)) await walk(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  for (const dir of ['src', 'app', 'program/src', 'scripts', 'tests', 'vendor/winterwallet']) await walk(dir);
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file + '\0' + createHash('sha256').update(await readFile(file)).digest('hex') + '\n');
  return hash.digest('hex');
}
