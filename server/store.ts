import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseRun, parseNotes, Problem } from '../shared/contracts.js';
import type { Run } from '../shared/contracts.js';
interface Row {
  id: string;
  digest: string;
  input_json: string;
  notes: string;
  version: number;
  created_at: string;
}
export class Ledger {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,digest TEXT NOT NULL UNIQUE,name TEXT NOT NULL,model TEXT NOT NULL,dataset TEXT NOT NULL,input_json TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC,id);`);
  }
  close(): void {
    this.db.close();
  }
  private decode(row: Row): Run {
    return {
      ...parseRun(JSON.parse(row.input_json) as unknown),
      id: row.id,
      digest: row.digest,
      notes: row.notes,
      version: row.version,
      createdAt: row.created_at,
    };
  }
  import(value: unknown): { run: Run; created: boolean } {
    const input = parseRun(value),
      json = JSON.stringify(input);
    const digest = createHash('sha256').update(json).digest('hex');
    const result = this.db
      .prepare(
        'INSERT OR IGNORE INTO runs(id,digest,name,model,dataset,input_json,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        digest,
        input.name,
        input.model,
        input.dataset,
        json,
        new Date().toISOString(),
      );
    const row = this.db.prepare('SELECT * FROM runs WHERE digest=?').get(digest) as unknown as Row;
    return { run: this.decode(row), created: Number(result.changes) === 1 };
  }
  get(id: string): Run {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as unknown as
      Row | undefined;
    if (!row) throw new Problem('Run not found.', 404);
    return this.decode(row);
  }
  list(query = ''): { runs: Run[]; truncated: boolean } {
    if (query.length > 200) throw new Problem('Filter is too long.');
    const rows = this.db
      .prepare(
        "SELECT * FROM runs WHERE instr(lower(name||' '||model||' '||dataset),lower(?))>0 ORDER BY created_at DESC,id LIMIT 201",
      )
      .all(query) as unknown as Row[];
    return { runs: rows.slice(0, 200).map((r) => this.decode(r)), truncated: rows.length > 200 };
  }
  updateNotes(id: string, value: unknown): Run {
    const { notes, version } = parseNotes(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db
        .prepare('UPDATE runs SET notes=?,version=version+1 WHERE id=? AND version=?')
        .run(notes, id, version);
      if (Number(result.changes) === 0) {
        this.get(id);
        throw new Problem('Notes changed in another session. Reload before saving.', 409);
      }
      const updated = this.get(id);
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
