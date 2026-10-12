import { decrypt, encrypt, type Envelope } from './recovery.ts';
export interface Session { load<T>(): Promise<T | null>; save(value: unknown): Promise<void> }
export interface Store { exclusive<T>(password: string, task: (session: Session) => Promise<T>): Promise<T> }

export class BrowserStore implements Store {
  readonly databaseName: string;
  readonly lockName: string;
  constructor(profile: 'devnet-v1' | 'mainnet-v2' = 'devnet-v1') {
    if (!['devnet-v1', 'mainnet-v2'].includes(profile)) throw Error('Invalid encrypted storage profile');
    this.databaseName = profile === 'devnet-v1' ? 'shell-encrypted-v1' : 'shell-encrypted-mainnet-v2';
    this.lockName = profile === 'devnet-v1' ? 'SHELL:identity:v1' : 'SHELL:identity:mainnet:v2';
  }
  private async db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('identity');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('Encrypted storage unavailable'));
    });
  }
  async exists(): Promise<boolean> {
    const db = await this.db(); try {
      return await new Promise((resolve, reject) => { const tx = db.transaction('identity'); const r = tx.objectStore('identity').get('vault'); r.onsuccess = () => resolve(!!r.result); r.onerror = () => reject(Error('Storage read failed')); });
    } finally { db.close(); }
  }
  async exclusive<T>(password: string, task: (session: Session) => Promise<T>): Promise<T> {
    if (!globalThis.isSecureContext || !navigator.locks || !globalThis.indexedDB) throw Error('Signing requires a secure browser with Web Locks and IndexedDB.');
    return navigator.locks.request(this.lockName, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw Error('Another tab is using this identity. Wait for its operation to finish.');
      const db = await this.db();
      try {
        return await task({
          load: async <U>() => {
            const value = await new Promise<Envelope | undefined>((resolve, reject) => { const r = db.transaction('identity').objectStore('identity').get('vault'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(Error('Encrypted storage read failed')); });
            return value ? await decrypt<U>(value, password) : null;
          },
          save: async value => {
            const envelope = await encrypt(value, password);
            await new Promise<void>((resolve, reject) => {
              // strict durability is required; unsupported browsers fail closed.
              const tx = db.transaction('identity', 'readwrite', { durability: 'strict' });
              if (tx.durability !== 'strict') { tx.abort(); reject(Error('This browser cannot provide strict durable storage. Signing stopped before saving or exposing a signature.')); return; }
              tx.objectStore('identity').put(envelope, 'vault');
              tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(Error('Durable signing state could not be saved. Signing stopped.'));
            });
          },
        });
      } finally { db.close(); }
    });
  }
}
