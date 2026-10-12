PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  cluster TEXT NOT NULL CHECK(cluster = 'devnet'),
  program TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  input_mint TEXT NOT NULL,
  amount TEXT NOT NULL,
  minimum_out TEXT NOT NULL,
  deadline TEXT NOT NULL,
  receipt TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  signature TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  raw TEXT NOT NULL,
  last_valid_height INTEGER NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS finalized_receipts (
  address TEXT PRIMARY KEY,
  signature TEXT,
  kind INTEGER NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  fee TEXT NOT NULL,
  buyback TEXT NOT NULL,
  treasury TEXT NOT NULL,
  bought TEXT NOT NULL,
  burned TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  snapshot_slot INTEGER NOT NULL,
  public_record TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_time ON finalized_receipts(timestamp);
CREATE INDEX IF NOT EXISTS attempts_job ON attempts(job_id);
