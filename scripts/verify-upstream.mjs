import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const lock = JSON.parse(await readFile('source-lock.json', 'utf8'));
let count = 0;
for (const [path, expected] of Object.entries(lock.files)) {
  const data = await readFile(path);
  const actual = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if (actual !== expected) throw Error(`Pinned upstream file differs: ${path}`);
  count++;
}
console.log(`${count} vendored files verified against Git blob hashes at ${lock.winterwallet.commit}`);
