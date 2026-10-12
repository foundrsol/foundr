import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { ProtocolReceipt } from '../src/protocol/client.ts';
export type Job = { id: string; cluster: 'devnet'; program: string; nonce: string; input_mint: string; amount: string; minimum_out: string; deadline: string; receipt: string; state: string; updated_at: string };
export type Submission = { signature: string; job_id: string; raw: string; last_valid_height: number; state: string; error: string | null; created_at: string };
export class AccountingDatabase {
  db: DatabaseSync;
  constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec('PRAGMA foreign_keys=ON'); this.db.exec(readFileSync(new URL('./migrations/001.sql', import.meta.url), 'utf8')); }
  close() { this.db.close(); }
  plan(job: Job): { job: Job; created: boolean } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT * FROM jobs WHERE nonce=?').get(job.nonce) as Job | undefined;
      if (existing) {
        if (['failed','expired'].includes(existing.state) && existing.input_mint === job.input_mint && existing.amount === job.amount && existing.program === job.program && existing.receipt === job.receipt) {
          const renewed = { ...job, id: existing.id };
          this.db.prepare('UPDATE jobs SET minimum_out=?,deadline=?,state=?,updated_at=? WHERE id=?').run(job.minimum_out, job.deadline, 'planned', job.updated_at, existing.id);
          this.db.exec('COMMIT'); return { job: renewed, created: true };
        }
        this.db.exec('COMMIT'); return { job: existing, created: false };
      }
      this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.id, job.cluster, job.program, job.nonce, job.input_mint, job.amount, job.minimum_out, job.deadline, job.receipt, job.state, job.updated_at);
      this.db.exec('COMMIT'); return { job, created: true };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  pending(): Job[] { return this.db.prepare("SELECT * FROM jobs WHERE state NOT IN ('confirmed','failed','expired') ORDER BY updated_at").all() as Job[]; }
  submission(job: string): Submission | null { return this.db.prepare('SELECT * FROM attempts WHERE job_id=? ORDER BY rowid DESC LIMIT 1').get(job) as Submission | undefined ?? null; }
  signed(job: Job, attempt: Submission): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.submission(job.id);
      if (existing && !['failed','expired'].includes(existing.state)) throw Error('An unresolved submission already exists. Reconcile before signing again.');
      this.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?)').run(attempt.signature, attempt.job_id, attempt.raw, attempt.last_valid_height, attempt.state, attempt.error, attempt.created_at);
      this.db.prepare('UPDATE jobs SET state=?, updated_at=? WHERE id=?').run('signed', new Date().toISOString(), job.id); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  state(job: Job, state: string, error?: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('UPDATE jobs SET state=?, updated_at=? WHERE id=?').run(state, new Date().toISOString(), job.id); const a = this.submission(job.id); if (a) this.db.prepare('UPDATE attempts SET state=?, error=? WHERE signature=?').run(state, error ?? null, a.signature); this.db.exec('COMMIT'); }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  finalized(receipt: ProtocolReceipt, slot: number): void {
    if (!Number.isSafeInteger(slot) || slot < 0 || ![1,2,3,4].includes(receipt.kind) || receipt.burned < 0n || receipt.fee < 0n || (receipt.kind === 3 && (receipt.bought !== receipt.burned || receipt.burned <= 0n))) throw Error('Invalid finalized accounting record');
    const record = JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    const existing = this.db.prepare('SELECT public_record FROM finalized_receipts WHERE address=?').get(receipt.address) as { public_record: string } | undefined;
    if (existing) {
      const before = JSON.parse(existing.public_record), after = JSON.parse(record); delete before.signature; delete after.signature;
      if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('A finalized immutable receipt changed. Stop accounting.');
      if (receipt.signature) this.db.prepare('UPDATE finalized_receipts SET signature=? WHERE address=?').run(receipt.signature, receipt.address);
      return;
    }
    this.db.prepare('INSERT INTO finalized_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receipt.address, receipt.signature ?? null, receipt.kind, receipt.asset.toBase58(), receipt.amount.toString(), receipt.fee.toString(), receipt.buyback.toString(), receipt.treasury.toString(), receipt.bought.toString(), receipt.burned.toString(), receipt.timestamp.toString(), slot, record);
  }
  publicRecords() { return this.db.prepare('SELECT address,signature,kind,asset,amount,fee,buyback,treasury,bought,burned,timestamp,snapshot_slot FROM finalized_receipts ORDER BY rowid DESC LIMIT 100').all(); }
}
