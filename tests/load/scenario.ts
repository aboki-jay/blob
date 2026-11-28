/**
 * The load test: about 150 people using shared conversations at the same time.
 *
 * The scenario is the one agreed in docs/MILESTONE-2.md ("Load test decisions"):
 *
 *   1. A rush. Everyone opens a shared conversation within the same ten
 *      seconds, and one in five replies.
 *   2. Steady use. Everyone keeps reading and replying, one action each every
 *      ten seconds, for two minutes.
 *
 * It passes only if no request fails and no reply is lost or doubled. Some
 * replies are deliberately sent twice, the way an impatient click or a flaky
 * connection would, and must still appear once.
 *
 * It talks to the server through a `Transport`, so the same scenario runs
 * against the server in-process (tests/unit/api-load.test.ts, on every change)
 * and against a real copy over the network (scripts/load-test.ts).
 *
 * This file imports nothing, so plain Node can run it.
 */

export interface Answer {
  status: number;
  body: any;
  /** How long the request took, in milliseconds. */
  ms: number;
  /** Database work this request caused. Only known when running in-process. */
  work?: { trips: number; statements: number; rowsWritten: number };
}

export interface Transport {
  call(method: string, path: string, options?: { token?: string; body?: unknown }): Promise<Answer>;
  /** Moves the server's clock forward. Only possible in-process; over the network real time passes instead. */
  advance?(ms: number): void;
}

export interface LoadOptions {
  people: number;
  /** How many shared conversations the people are spread across. */
  conversations: number;
  /** Rounds of steady use. Twelve rounds ten seconds apart is two minutes. */
  rounds: number;
  /** Length of the rush, and the gap between rounds, in milliseconds. */
  windowMs: number;
  /**
   * True: actions are spread over real time, as people would be. False: each
   * window's actions are fired together, which is harsher on correctness and
   * takes seconds instead of minutes.
   */
  realTime: boolean;
  /** Makes the "random" choices repeatable. */
  seed: number;
  /**
   * True: when it is over, every person deletes their account, so a server that
   * keeps its data between runs (the test copy on Cloudflare) is left empty.
   * A deletion that fails counts as a failed request.
   */
  tidy?: boolean;
}

export const AGREED: LoadOptions = { people: 150, conversations: 15, rounds: 12, windowMs: 10_000, realTime: false, seed: 150 };

export interface Timing {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface LoadReport {
  people: number;
  requests: number;
  /** Requests that did not succeed. Must be empty. */
  failures: { kind: string; status: number; error?: string }[];
  repliesSent: number;
  /** Replies deliberately sent a second time. */
  repliesRetried: number;
  /** Replies that were accepted but are not in the conversation afterwards. Must be 0. */
  lost: number;
  /** Replies that appear more than once. Must be 0. */
  doubled: number;
  /** Comments in a conversation that nobody sent. Must be 0. */
  unexpected: number;
  timings: Record<string, Timing>;
  /** In-process only: the most database statements any one request needed, and the kind of request it was. */
  heaviest?: { kind: string; statements: number; trips: number };
  /** In-process only: rows written by one reply, sharing included. */
  rowsWrittenPerReply?: number;
  passed: boolean;
}

/** A small repeatable random number generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const newId = () => crypto.randomUUID();

function summarise(samples: number[]): Timing {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return { count: sorted.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(sorted.at(-1) ?? 0) };
}

export async function runLoad(transport: Transport, options: LoadOptions = AGREED): Promise<LoadReport> {
  const pick = random(options.seed);
  const samples: Record<string, number[]> = {};
  const failures: LoadReport['failures'] = [];
  let requests = 0;
  let heaviest: LoadReport['heaviest'];
  const replyWrites: number[] = [];

  /** One request, recorded. Returns the answer, or null if it failed. */
  const request = async (kind: string, method: string, path: string, token?: string, body?: unknown): Promise<Answer | null> => {
    requests++;
    const answer = await transport.call(method, path, { token, body });
    (samples[kind] ??= []).push(answer.ms);
    if (answer.work && (!heaviest || answer.work.statements > heaviest.statements)) heaviest = { kind, statements: answer.work.statements, trips: answer.work.trips };
    if (kind === 'reply' && answer.work && answer.status === 200) replyWrites.push(answer.work.rowsWritten);
    if (answer.status !== 200 || !answer.body?.ok) {
      failures.push({ kind, status: answer.status, error: answer.body?.error });
      return null;
    }
    return answer;
  };

  /** Runs one window's actions: spread over the window in real time, or all together. */
  const during = async (actions: (() => Promise<unknown>)[]) => {
    await Promise.all(
      actions.map(async (action) => {
        if (options.realTime) await sleep(pick() * options.windowMs);
        await action();
      }),
    );
    if (!options.realTime) transport.advance?.(options.windowMs);
  };

  /* ----- Getting ready: accounts, and the conversations to be shared ----- */

  const run = newId().slice(0, 8);
  const people = (
    await Promise.all(
      Array.from({ length: options.people }, async (_, index) => {
        const answer = await request('sign-in', 'POST', '/test/sign-in', undefined, { name: `Person ${index + 1}`, subject: `load-${run}-${index}` });
        return { index, token: answer?.body.token as string | undefined };
      }),
    )
  ).filter((person): person is { index: number; token: string } => Boolean(person.token));

  /** For each conversation: its link code, its owner, and every reply the test sent to it. */
  const conversations = (
    await Promise.all(
      people.slice(0, options.conversations).map(async (owner) => {
        const rootId = newId();
        const answer = await request('share', 'POST', '/shares', owner.token, {
          id: newId(),
          page: { url: `https://example.com/load/${owner.index}`, title: `Load test page ${owner.index}` },
          anchor: { selector: 'main > h1', tag: 'h1', label: 'Heading “Load test”', offset: { x: 0.5, y: 0.5 } },
          expires: '7d',
          messages: [{ id: rootId, body: 'What does everyone think?' }],
        });
        const url = answer?.body.share.url as string | undefined;
        return url ? { owner, code: url.split('/t/')[1]!, rootId, sent: new Set<string>() } : null;
      }),
    )
  ).filter((conversation) => conversation !== null);

  if (people.length < options.people || conversations.length < options.conversations) {
    // Nothing useful can be measured without the cast. The failures say why.
    await tidy();
    return finish();
  }

  let repliesSent = 0;
  let repliesRetried = 0;
  const conversationOf = (person: { index: number }) => conversations[person.index % conversations.length]!;
  const read = (person: { index: number; token: string }) => request('read', 'GET', `/shares/${conversationOf(person).code}`, person.token);
  const reply = async (person: { index: number; token: string }) => {
    const conversation = conversationOf(person);
    const message = { id: newId(), body: `Reply from person ${person.index + 1}`, replyTo: conversation.rootId };
    conversation.sent.add(message.id);
    repliesSent++;
    const path = `/shares/${conversation.code}/messages`;
    // One reply in ten is sent twice at the same moment, as a double click would.
    if (pick() < 0.1) {
      repliesRetried++;
      await Promise.all([request('reply', 'POST', path, person.token, message), request('reply', 'POST', path, person.token, message)]);
    } else {
      await request('reply', 'POST', path, person.token, message);
    }
  };

  /* ----- 1. The rush: everyone opens a conversation; one in five replies ----- */

  await during(
    people.map((person) => async () => {
      await read(person);
      if (person.index % 5 === 0) await reply(person);
    }),
  );

  /* ----- 2. Steady use: one action each, every window, for the agreed number of rounds ----- */

  for (let round = 0; round < options.rounds; round++) {
    await during(people.map((person) => () => (pick() < 1 / 3 ? reply(person) : read(person))));
  }

  /* ----- Afterwards: is every reply there, exactly once? ----- */

  let lost = 0;
  let doubled = 0;
  let unexpected = 0;
  for (const conversation of conversations) {
    const answer = await request('check', 'GET', `/shares/${conversation.code}`, conversation.owner.token);
    const seen = new Map<string, number>();
    for (const message of (answer?.body.messages ?? []) as { id: string }[]) seen.set(message.id, (seen.get(message.id) ?? 0) + 1);
    for (const id of conversation.sent) {
      const times = seen.get(id) ?? 0;
      if (times === 0) lost++;
      if (times > 1) doubled++;
    }
    for (const id of seen.keys()) if (id !== conversation.rootId && !conversation.sent.has(id)) unexpected++;
  }

  await tidy();
  return finish({ repliesSent, repliesRetried, lost, doubled, unexpected });

  /** Everyone deletes their account, all at once. Deleting an account deletes all that was theirs. */
  async function tidy() {
    if (options.tidy) await Promise.all(people.map((person) => request('tidy', 'DELETE', '/me', person.token)));
  }

  function finish(counts = { repliesSent: 0, repliesRetried: 0, lost: 0, doubled: 0, unexpected: 0 }): LoadReport {
    const timings: Record<string, Timing> = {};
    for (const [kind, values] of Object.entries(samples)) timings[kind] = summarise(values);
    const complete = people.length === options.people && conversations.length === options.conversations;
    return {
      people: people.length,
      requests,
      failures,
      ...counts,
      timings,
      heaviest,
      rowsWrittenPerReply: replyWrites.length ? Math.max(...replyWrites) : undefined,
      passed: complete && failures.length === 0 && counts.lost === 0 && counts.doubled === 0 && counts.unexpected === 0,
    };
  }
}
