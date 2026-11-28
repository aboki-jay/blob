-- Blob sharing server: the first version of its database (Cloudflare D1, which is SQLite).
--
-- What is kept, and why, is set out in docs/MILESTONE-2.md under "What the
-- server keeps". In short: shared conversations, a random id and a display name
-- per account, and scrambled fingerprints for sign-in identities and sessions.
-- No passwords, no readable email addresses, nothing about unshared comments.
--
-- Deleting an account, or a shared conversation, removes everything that hangs
-- off it (ON DELETE CASCADE). D1 enforces these links.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,            -- random, made by the server
  name TEXT NOT NULL,             -- shown beside this person's comments
  created_at INTEGER NOT NULL     -- milliseconds since 1970, like every time here
);

-- A way of signing in, attached to an account. The fingerprint is a keyed
-- scramble of "kind:subject" (Google's account number, or an email address).
-- The number or address itself is never stored.
CREATE TABLE identities (
  fingerprint TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX identities_account ON identities(account_id);

-- Someone signed in. Only a scramble of the session's secret is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- A shared conversation. `id` is chosen by the owner's device, so that trying
-- again after a failed upload cannot create a second copy. `code` is the long
-- random value in the link; it is not the id.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,         -- already stripped of credentials and tokens
  page_title TEXT NOT NULL,
  anchor TEXT NOT NULL,           -- JSON: the description of the pinned element
  root_id TEXT NOT NULL,          -- the first comment, which cannot be deleted on its own
  expires_at INTEGER,             -- NULL means "until I stop sharing"
  created_at INTEGER NOT NULL
);
CREATE INDEX shares_owner ON shares(owner_id);
CREATE INDEX shares_expiry ON shares(expires_at) WHERE expires_at IS NOT NULL;

-- A comment or reply in a shared conversation. Ids come from the device that
-- wrote it, so a retry cannot post twice.
CREATE TABLE messages (
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,             -- plain text
  reply_to TEXT,                  -- the comment this answers, if any
  carried_name TEXT,              -- set when the owner carried this reply over from an earlier link:
                                  -- the name it is shown under, which the server cannot vouch for
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, id)
);
CREATE INDEX messages_author ON messages(author_id);
CREATE INDEX messages_order ON messages(share_id, created_at);

-- Firm limits (sign-ins, shares, replies per person), counted here because
-- Cloudflare's own limiter proved too loose. One row per person, action and
-- time window; old rows are swept away.
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX counters_expiry ON counters(expires_at);
