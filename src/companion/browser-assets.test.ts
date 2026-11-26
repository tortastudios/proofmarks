import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { prepareBrowserAssets } from './browser-assets';

async function fixture() {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(new URL('browser-assets-', work).pathname);
  await mkdir(path.join(root, 'src/overlay/nested'), { recursive: true });
  await mkdir(path.join(root, 'scripts'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'src/overlay/nested/prose.ts'), 'export const prose = true;');
  await writeFile(
    path.join(root, 'scripts/build-browser.mjs'),
    `
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
await appendFile('builds', 'one\\n');
await new Promise(resolve => setTimeout(resolve, 100));
await mkdir('dist', { recursive: true });
await writeFile('dist/script.js', 'function mountProofmarks() {}');
await writeFile('dist/proofmarks-font.js', 'export const handwritingFont = "fixture";');
await writeFile('dist/chunk-TEST.js', 'export const shared = true;');
await writeFile('dist/sizes.json', JSON.stringify([{file:'script.js'},{file:'proofmarks-font.js'},{file:'chunk-TEST.js'}]));
`,
  );
  return {
    root,
    count: async () => (await readFile(path.join(root, 'builds'), 'utf8')).trim().split('\n').length,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test('missing assets build once, unchanged starts reuse them, and a missing font rebuilds', async () => {
  const f = await fixture(),
    lines: string[] = [];
  try {
    const options = {
      packageRoot: f.root,
      log: (line: string) => {
        lines.push(line);
      },
    };
    const results = await Promise.all(Array.from({ length: 4 }, () => prepareBrowserAssets(options)));
    for (const assets of results) assert.match(assets.script.toString(), /mountProofmarks/);
    await prepareBrowserAssets(options);
    assert.equal(await f.count(), 1);
    assert.equal(lines.length, 1);
    await unlink(path.join(f.root, 'dist/proofmarks-font.js'));
    await prepareBrowserAssets(options);
    assert.equal(await f.count(), 2);
    assert.equal(lines.length, 2);
  } finally {
    await f.close();
  }
});
test('any newer nested overlay source rebuilds stale browser assets', async () => {
  const f = await fixture();
  try {
    const options = { packageRoot: f.root, log: () => {} };
    await prepareBrowserAssets(options);
    const old = new Date(Date.now() - 60000);
    await utimes(path.join(f.root, 'dist/script.js'), old, old);
    await utimes(path.join(f.root, 'dist/proofmarks-font.js'), old, old);
    await prepareBrowserAssets(options);
    assert.equal(await f.count(), 2);
    await prepareBrowserAssets(options);
    assert.equal(await f.count(), 2);
  } finally {
    await f.close();
  }
});
test('concurrent helper processes share the package build lock and observe complete output', async () => {
  const f = await fixture();
  try {
    const entry = new URL('./browser-assets.ts', import.meta.url).href;
    const loader = fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url));
    const code = `const {prepareBrowserAssets}=await import(${JSON.stringify(entry)});const assets=await prepareBrowserAssets({packageRoot:${JSON.stringify(f.root)},log:()=>{}});if(assets.script.toString()!=='function mountProofmarks() {}')process.exitCode=1;`;
    const run = () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', loader, '--input-type=module', '--eval', code], {
          stdio: 'ignore',
        });
        child.once('error', reject);
        child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`Browser startup exited ${code}`))));
      });
    await Promise.all([run(), run()]);
    assert.equal(await f.count(), 1);
    assert.equal(
      await readFile(path.join(f.root, 'dist/proofmarks-font.js'), 'utf8'),
      'export const handwritingFont = "fixture";',
    );
  } finally {
    await f.close();
  }
});
test('without esbuild, missing assets return executable setup-hint JavaScript and stale prebuilt assets remain usable', async () => {
  const f = await fixture(),
    lines: string[] = [];
  try {
    const options = {
      packageRoot: f.root,
      resolveBundler: () => {
        throw new Error('esbuild is not installed');
      },
      log: (line: string) => {
        lines.push(line);
      },
    };
    const fallback = await prepareBrowserAssets(options),
      warnings: string[] = [];
    runInNewContext(fallback.script.toString(), { console: { warn: (message: string) => warnings.push(message) } });
    assert.deepEqual(warnings, [
      "Proofmarks couldn't build its page script. Run npm run build:browser in the package.",
    ]);
    assert.equal(lines.length, 1);
    await assert.rejects(readFile(path.join(f.root, 'builds')), { code: 'ENOENT' });
    await mkdir(path.join(f.root, 'dist'));
    await writeFile(path.join(f.root, 'dist/script.js'), '// published script');
    await writeFile(path.join(f.root, 'dist/proofmarks-font.js'), '// published font');
    const old = new Date(Date.now() - 60000);
    await utimes(path.join(f.root, 'dist/script.js'), old, old);
    const published = await prepareBrowserAssets(options);
    assert.equal(published.script.toString(), '// published script');
    assert.equal(published.font.toString(), '// published font');
    await assert.rejects(readFile(path.join(f.root, 'builds')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

test('a missing shared browser chunk rebuilds and is served from the generated allow-list', async () => {
  const f = await fixture();
  try {
    const options = { packageRoot: f.root, log: () => {} };
    const first = await prepareBrowserAssets(options);
    assert.equal(first.modules['chunk-TEST.js']?.toString(), 'export const shared = true;');
    await unlink(path.join(f.root, 'dist/chunk-TEST.js'));
    const rebuilt = await prepareBrowserAssets(options);
    assert.equal(await f.count(), 2);
    assert.equal(rebuilt.modules['chunk-TEST.js']?.toString(), 'export const shared = true;');
    assert.equal(Object.hasOwn(rebuilt.modules, 'constructor'), false);
  } finally {
    await f.close();
  }
});
