import { describe, expect, it } from 'vitest';
import { AGREED, runLoad, type Transport } from '../load/scenario';
import { createServer } from './api-helpers';

/**
 * The 150-person load test, run against the real server code in-process.
 *
 * This shows that Blob's own code holds up: nothing is lost or doubled when
 * 150 people act together, and no request asks more of the database than
 * Cloudflare's free plan allows. It says nothing about Cloudflare's speed or
 * capacity; for that, scripts/load-test.ts runs the same scenario against a
 * deployed test copy.
 */

/** Cloudflare's free plan allows 50 database queries per request. Blob should need only a handful. */
const STATEMENTS_ALLOWED = 50;
const STATEMENTS_EXPECTED = 8;

function inProcess(): Transport {
  const server = createServer();
  return {
    advance: (ms) => {
      server.clock.now += ms;
    },
    async call(method, path, options) {
      const started = performance.now();
      const { value, tally } = await server.db.measure(() => server.call(method, path, options));
      return { status: value.status, body: value.body, ms: performance.now() - started, work: tally };
    },
  };
}

describe('150 people at the same time', () => {
  it('loses nothing, doubles nothing, and refuses nobody', async () => {
    const report = await runLoad(inProcess(), AGREED);

    // Said plainly, so a failure reads as what went wrong.
    expect(report.failures.slice(0, 5), 'requests that failed').toEqual([]);
    expect({ lost: report.lost, doubled: report.doubled, unexpected: report.unexpected }).toEqual({ lost: 0, doubled: 0, unexpected: 0 });
    expect(report.passed).toBe(true);

    // The scenario really was the agreed size: everyone signed in, read and replied.
    expect(report.people).toBe(150);
    expect(report.timings.read!.count).toBeGreaterThan(1000);
    expect(report.repliesSent).toBeGreaterThan(400);
    expect(report.repliesRetried).toBeGreaterThan(20);
    expect(report.requests).toBeGreaterThan(2000);

    // Every request stays light: well inside the free plan's allowance.
    expect(report.heaviest!.statements).toBeLessThanOrEqual(STATEMENTS_EXPECTED);
    expect(report.heaviest!.statements).toBeLessThan(STATEMENTS_ALLOWED);
    // A reply costs at most three rows: the comment and its two counters.
    expect(report.rowsWrittenPerReply).toBeLessThanOrEqual(3);

    console.log(
      `[load] ${report.people} people, ${report.requests} requests, ${report.repliesSent} replies (${report.repliesRetried} sent twice). ` +
        `Heaviest request: ${report.heaviest!.kind}, ${report.heaviest!.statements} statements in ${report.heaviest!.trips} trips. ` +
        `Local timings, not judged: read p95 ${report.timings.read!.p95} ms, reply p95 ${report.timings.reply!.p95} ms.`,
    );
  }, 60_000);

  it('still holds when the same thing happens with a different shuffle', async () => {
    const report = await runLoad(inProcess(), { ...AGREED, seed: 7, conversations: 3 });
    expect(report.failures.slice(0, 5)).toEqual([]);
    expect(report.passed).toBe(true);
  }, 60_000);
});
