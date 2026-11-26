import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, chmod, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
// Preserve entry depth: package data URLs stay relative to the package root.
await build({
  entryPoints: ['src/companion/cli.ts', 'src/next/index.ts', 'src/pi/extension.ts'],
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  minify: true,
  splitting: true,
  chunkNames: 'shared/node-[hash]',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  banner: { js: '// Built by Proofmarks.' },
});
await mkdir('dist/companion', { recursive: true });
await writeFile('dist/companion/bin.mjs', "#!/usr/bin/env node\nawait import('./cli.js');\n");
await chmod('dist/companion/bin.mjs', 0o755);
await mkdir('dist/config', { recursive: true });
await copyFile('src/config/index.mjs', 'dist/config/index.mjs');
await copyFile('src/config/index.d.mts', 'dist/config/index.d.mts');
execFileSync(process.execPath, ['scripts/build-browser.mjs'], { stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });

await copyFile('src/config/index.d.mts', 'dist/types/config/index.d.mts');
await import('./prune-types.mjs');
