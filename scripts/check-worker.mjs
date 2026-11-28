// Checks the sharing server's configuration (worker/api/wrangler.jsonc).
//
// The server has a test-only sign-in, so that tests can have accounts without
// Google. It must be impossible to switch on for the real service. The server
// itself refuses it at the real address; this is the second lock: a
// configuration that would switch it on for the real service fails the check
// before it can be deployed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../worker/api/wrangler.jsonc', import.meta.url));
// The file has comments, which plain JSON does not allow. Remove whole-line ones.
const text = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
const config = JSON.parse(text);
const source = readFileSync(fileURLToPath(new URL('../worker/api/src/index.ts', import.meta.url)), 'utf8');

const problems = [];
const test = config.env?.test;

if (config.vars && 'TEST_SIGN_IN' in config.vars) problems.push('TEST_SIGN_IN is set for the real service. It may only appear under env.test.');
for (const [name, env] of Object.entries(config.env ?? {})) {
  if (name !== 'test' && env?.vars && 'TEST_SIGN_IN' in env.vars) problems.push(`TEST_SIGN_IN is set for "${name}". It may only appear under env.test.`);
}
if (config.workers_dev !== false) problems.push('The real service must not have a workers.dev address (workers_dev must be false).');
if (!test) problems.push('There is no env.test: the test copy is not described.');
else {
  if (test.name !== 'blob-api-test') problems.push('The test copy must be named "blob-api-test": the server only allows the test sign-in at that name.');
  if (test.name === config.name) problems.push('The test copy has the same name as the real service.');
  if (test.routes?.length) problems.push('The test copy must not be given a public address of its own (no routes).');
  const [realDb, testDb] = [config.d1_databases?.[0], test.d1_databases?.[0]];
  if (!testDb || testDb.database_name === realDb?.database_name) problems.push('The test copy must have its own database, by a different name.');
  if (testDb && realDb && !testDb.database_id.startsWith('REPLACE-') && testDb.database_id === realDb.database_id) problems.push('The test copy uses the real database.');
}

// The server must know the real address, so it can refuse the test sign-in there.
const origin = config.vars?.PUBLIC_ORIGIN;
const host = origin ? new URL(origin).hostname : null;
if (!host) problems.push('PUBLIC_ORIGIN is missing: shared links need an address.');
else if (!new RegExp(`PRODUCTION_HOSTS\\s*=\\s*\\[[^\\]]*'${host.replaceAll('.', '\\.')}'`).test(source)) {
  problems.push(`The server's PRODUCTION_HOSTS does not list ${host}, so the test sign-in would not be refused there.`);
}

if (problems.length) {
  console.error('Worker check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('Worker check passed: the test-only sign-in is confined to the test copy.');
