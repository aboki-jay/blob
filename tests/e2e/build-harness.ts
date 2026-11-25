import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/** Bundles tests/e2e/harness.ts into one script the browser tests can load. */
export default async function buildHarness(): Promise<void> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': root } },
    build: {
      outDir: fileURLToPath(new URL('../../.output/harness', import.meta.url)),
      emptyOutDir: true,
      minify: false,
      lib: { entry: fileURLToPath(new URL('./harness.ts', import.meta.url)), formats: ['iife'], name: 'BlobHarness', fileName: () => 'harness.js' },
    },
  });
}
