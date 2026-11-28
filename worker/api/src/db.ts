/**
 * The part of Cloudflare D1 the server relies on. Cloudflare's own database
 * object fits this shape; the tests pass a stand-in built on SQLite, which is
 * what D1 is underneath.
 */

export interface DbResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run(): Promise<DbResult>;
}

export interface Db {
  prepare(sql: string): DbStatement;
  /**
   * Runs several statements as one step: either all of them happen or none do,
   * and nothing else can slip in between. Most rules below depend on this.
   */
  batch<T = Record<string, unknown>>(statements: DbStatement[]): Promise<DbResult<T>[]>;
}
