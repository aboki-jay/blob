// Fails if the built extension asks for more than it should. Run after `npm run build`.
// The generated manifest is what Chrome actually enforces, so this checks that, not the config.
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../.output/chrome-mv3/manifest.json', import.meta.url), 'utf8'));
const problems = [];
const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if (!same(manifest.permissions, ['activeTab', 'scripting', 'storage'])) {
  problems.push(`permissions changed: ${JSON.stringify(manifest.permissions)}`);
}
if (!same(manifest.optional_host_permissions, ['https://*/*', 'http://*/*'])) {
  problems.push(`optional_host_permissions changed: ${JSON.stringify(manifest.optional_host_permissions)}`);
}
for (const key of ['host_permissions', 'content_scripts', 'web_accessible_resources', 'externally_connectable', 'optional_permissions']) {
  if (manifest[key]) problems.push(`"${key}" must not be present: ${JSON.stringify(manifest[key])}`);
}

if (problems.length) {
  console.error(`Manifest check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Manifest check passed: activeTab, scripting, storage; site access is optional and per website.');
