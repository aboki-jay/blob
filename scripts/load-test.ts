// Runs the 150-person load test against a running copy of the sharing server.
//
//   node scripts/load-test.ts --url http://127.0.0.1:8787              (a local `wrangler dev --env test`)
//   node scripts/load-test.ts --url https://blob-api-test.<you>.workers.dev --real-time --judge-time
//
// Only ever point this at a developer's machine or the test copy. It signs in
// through the test-only sign-in, which the real service does not have, so
// against the real service it stops at once without doing anything.
//
//   --real-time    spread the actions over real time, as people would be
//                  (about two minutes). Without it they are fired together.
//   --judge-time   also require 95 in 100 responses within one second. Only
//                  meaningful against Cloudflare, not a developer's machine.
//   --people N     fewer or more people than the agreed 150.
import { AGREED, runLoad, type Transport } from '../tests/load/scenario.ts';

const args = process.argv.slice(2);
const value = (flag: string) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const base = value('--url')?.replace(/\/+$/, '');
if (!base) {
  console.error('Give the server to test: --url http://127.0.0.1:8787');
  process.exit(2);
}
const realTime = args.includes('--real-time');
const judgeTime = args.includes('--judge-time');
const people = Number(value('--people') ?? AGREED.people);

const transport: Transport = {
  async call(method, path, options = {}) {
    const headers: Record<string, string> = { 'user-agent': 'blob-load-test' };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const started = performance.now();
    try {
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { ok: false, error: `not JSON: ${text.slice(0, 60)}` };
      }
      return { status: response.status, body, ms: performance.now() - started };
    } catch (error) {
      return { status: 0, body: { ok: false, error: String(error).slice(0, 80) }, ms: performance.now() - started };
    }
  },
};

const health = await transport.call('GET', '/health');
if (health.status !== 200) {
  console.error(`No server answered at ${base} (${health.status || health.body.error}).`);
  process.exit(2);
}

console.log(`Load test: ${people} people against ${base}, ${realTime ? 'in real time (about two minutes)' : 'all at once'}.`);
const report = await runLoad(transport, { ...AGREED, people, conversations: Math.max(1, Math.round(people / 10)), realTime });

const row = (kind: string) => {
  const t = report.timings[kind];
  return t ? `  ${kind.padEnd(8)} ${String(t.count).padStart(5)} requests   half within ${t.p50} ms   95 in 100 within ${t.p95} ms   slowest ${t.max} ms` : '';
};
console.log(['sign-in', 'share', 'read', 'reply', 'check'].map(row).filter(Boolean).join('\n'));
console.log(`  ${report.requests} requests in all; ${report.repliesSent} replies, ${report.repliesRetried} of them sent twice on purpose.`);
console.log(`  Failed requests: ${report.failures.length}.  Replies lost: ${report.lost}.  Doubled: ${report.doubled}.  Unexpected: ${report.unexpected}.`);
if (report.failures.length) {
  const kinds = new Map<string, number>();
  for (const failure of report.failures) {
    const key = `${failure.kind} -> ${failure.status} ${failure.error ?? ''}`.trim();
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  for (const [key, count] of kinds) console.log(`    ${count} x ${key}`);
}

let passed = report.passed;
if (judgeTime) {
  const slow = ['read', 'reply'].filter((kind) => (report.timings[kind]?.p95 ?? 0) > 1000);
  if (slow.length) {
    passed = false;
    console.log(`  Too slow: 95 in 100 ${slow.join(' and ')} responses did not arrive within one second.`);
  }
} else {
  console.log('  Response times above are reported, not judged (add --judge-time against Cloudflare).');
}
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
