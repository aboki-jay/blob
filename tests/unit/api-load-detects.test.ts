import { describe, expect, it } from 'vitest';
import { AGREED, runLoad, type Transport } from '../load/scenario';
import { createServer } from './api-helpers';

/**
 * A test that cannot fail proves nothing. These run the load test against a
 * server that has been deliberately broken, and check that the load test says
 * so. Kept small (30 people) because the point is the verdict, not the load.
 */

const SMALL = { ...AGREED, people: 30, conversations: 3, rounds: 4 };

/** The real server, with one kind of fault added between it and the load test. */
function faulty(fault: (method: string, path: string, real: () => Promise<{ status: number; body: any }>) => Promise<{ status: number; body: any }>): Transport {
  const server = createServer();
  return {
    advance: (ms) => {
      server.clock.now += ms;
    },
    async call(method, path, options) {
      const answer = await fault(method, path, () => server.call(method, path, options));
      return { ...answer, ms: 1 };
    },
  };
}

describe('the load test notices when something is wrong', () => {
  it('a healthy server passes at this size', async () => {
    const report = await runLoad(faulty((_method, _path, real) => real()), SMALL);
    expect(report.passed).toBe(true);
  });

  it('a reply that was accepted but not saved counts as lost', async () => {
    let dropped = false;
    const report = await runLoad(
      faulty(async (method, path, real) => {
        if (!dropped && method === 'POST' && path.endsWith('/messages')) {
          dropped = true;
          return { status: 200, body: { ok: true, message: {} } }; // says yes, saves nothing
        }
        return real();
      }),
      SMALL,
    );
    expect(report.lost).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('a reply that shows up twice counts as doubled', async () => {
    const report = await runLoad(
      faulty(async (method, path, real) => {
        const answer = await real();
        const messages = answer.body?.messages;
        // The final check reads each conversation: repeat one reply in what comes back.
        if (method === 'GET' && Array.isArray(messages) && messages.length > 5) answer.body.messages = [...messages, messages[1]];
        return answer;
      }),
      SMALL,
    );
    expect(report.doubled).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });

  it('a single refused request fails the run', async () => {
    let refused = false;
    const report = await runLoad(
      faulty(async (method, path, real) => {
        if (!refused && method === 'GET' && path.startsWith('/shares/')) {
          refused = true;
          return { status: 503, body: { ok: false, error: 'busy' } };
        }
        return real();
      }),
      SMALL,
    );
    expect(report.failures).toEqual([{ kind: 'read', status: 503, error: 'busy' }]);
    expect(report.passed).toBe(false);
  });

  it('a comment nobody sent counts as unexpected', async () => {
    const report = await runLoad(
      faulty(async (method, _path, real) => {
        const answer = await real();
        if (method === 'GET' && Array.isArray(answer.body?.messages)) answer.body.messages = [...answer.body.messages, { id: 'from-nowhere-0001' }];
        return answer;
      }),
      SMALL,
    );
    expect(report.unexpected).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });
});
