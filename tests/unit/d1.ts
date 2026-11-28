/**
 * A stand-in for Cloudflare's D1 database, for tests.
 *
 * D1 is SQLite, so this uses the SQLite built into Node and runs the server's
 * real statements against the real migration. It copies the two behaviours the
 * server's rules lean on: a batch is one all-or-nothing step, and separate
 * calls can interleave with other people's (each call waits a tick first, as a
 * network round trip would).
 *
 * It also counts the work done, per request, so the load test can check that no
 * request needs more than Cloudflare's free plan allows.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { Db, DbResult, DbStatement } from '../../worker/api/src/db';

const MIGRATION = fileURLToPath(new URL('../../worker/api/migrations/0001_init.sql', import.meta.url));

export interface Tally {
  /** Trips to the database (a batch is one trip). */
  trips: number;
  /** Statements run, in or out of a batch. Cloudflare's free plan allows 50 per request. */
  statements: number;
  rowsWritten: number;
}

const newTally = (): Tally => ({ trips: 0, statements: 0, rowsWritten: 0 });

export interface TestDb extends Db {
  /** Everything since the database was made. */
  total: Tally;
  /** Runs `task` and reports the database work it alone caused, even with others running. */
  measure<T>(task: () => Promise<T>): Promise<{ value: T; tally: Tally }>;
  /** Makes every call fail, as an overloaded or over-limit database would. */
  failing: boolean;
  /** For looking at what is really stored. */
  raw: DatabaseSync;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const readsRows = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

export function createTestDb(): TestDb {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON'); // D1 enforces these links by default
  raw.exec(readFileSync(MIGRATION, 'utf8'));

  const total = newTally();
  const current = new AsyncLocalStorage<Tally>();
  const count = (field: keyof Tally, amount = 1) => {
    total[field] += amount;
    const mine = current.getStore();
    if (mine) mine[field] += amount;
  };

  const execute = (sql: string, values: unknown[]): DbResult => {
    count('statements');
    const statement = raw.prepare(sql);
    const bound = values.map((value) => (typeof value === 'boolean' ? Number(value) : value)) as (string | number | null)[];
    if (readsRows(sql)) return { results: statement.all(...bound) as Record<string, unknown>[], meta: { changes: 0 } };
    const changes = Number(statement.run(...bound).changes);
    count('rowsWritten', changes);
    return { results: [], meta: { changes } };
  };

  interface Bound extends DbStatement {
    sql: string;
    values: unknown[];
  }
  const statement = (sql: string, values: unknown[] = []): Bound => ({
    sql,
    values,
    bind: (...next: unknown[]) => statement(sql, next),
    async all<T>() {
      await tick();
      if (db.failing) throw new Error('D1_ERROR: overloaded');
      count('trips');
      return execute(sql, values) as DbResult<T>;
    },
    async run() {
      await tick();
      if (db.failing) throw new Error('D1_ERROR: overloaded');
      count('trips');
      return execute(sql, values);
    },
  });

  const db: TestDb = {
    total,
    raw,
    failing: false,
    prepare: (sql) => statement(sql),
    async batch<T>(statements: DbStatement[]) {
      await tick();
      if (db.failing) throw new Error('D1_ERROR: overloaded');
      count('trips');
      // One synchronous block: nothing else can run inside it, and it is undone as a whole on error.
      raw.exec('BEGIN IMMEDIATE');
      try {
        const results = (statements as Bound[]).map((each) => execute(each.sql, each.values));
        raw.exec('COMMIT');
        return results as DbResult<T>[];
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    async measure<T>(task: () => Promise<T>) {
      const tally = newTally();
      const value = await current.run(tally, task);
      return { value, tally };
    },
  };
  return db;
}
