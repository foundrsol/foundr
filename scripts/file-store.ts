// CLI verification only. Browser signing uses BrowserStore and Web Locks.
import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Session, Store } from '../src/core/store.ts';
import { decrypt, encrypt, type Envelope } from '../src/core/recovery.ts';
export class FileStore implements Store {
  private path: string;
  constructor(path: string) { this.path = path; }
  async exclusive<T>(password: string, task: (session: Session) => Promise<T>): Promise<T> {
    const lock = await open(`${this.path}.lock`, 'wx', 0o600);
    try { return await task({
      load: async <U>() => { let data: string; try { data = await readFile(this.path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } return decrypt<U>(JSON.parse(data) as Envelope, password); },
      save: async value => { const e = await encrypt(value, password), temp = `${this.path}.tmp`; await writeFile(temp, JSON.stringify(e), { mode: 0o600 }); const handle = await open(temp, 'r+'); try { await handle.sync(); } finally { await handle.close(); } await rename(temp, this.path); const directory = await open(dirname(this.path), 'r'); try { await directory.sync(); } finally { await directory.close(); } },
    }); } finally { await lock.close(); await unlink(`${this.path}.lock`); }
  }
}
