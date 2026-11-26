import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { fixture } from '../server/fixture';
import { devPage } from './dev-page';
import path from 'node:path';
const run = async (cwd: string, args: string[]) => {
  try {
    await promisify(execFile)(process.execPath, [new URL('./bin.mjs', import.meta.url).pathname, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: cwd },
    });
    return '';
  } catch (error) {
    return String((error as { stderr?: string }).stderr).trim();
  }
};
test('plain CLI problems read as written, never as a judge failure', async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(new URL('cli-', work).pathname);
  try {
    assert.match(
      await run(dir, ['init']),
      /^No writing found in content, src\/content, .*proofmarks init --content <folder>$/,
    );
    assert.equal(await run(dir, ['dev', '--judge', 'fake']), 'Run proofmarks init before starting the dev proxy.');
    assert.match(await run(dir, ['nonsense']), /^Usage: proofmarks init/);
    for (const message of [await run(dir, ['init']), await run(dir, ['dev', '--judge', 'fake'])])
      assert.doesNotMatch(message, /Judge failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('review prints one line for people, and the per-call ledger only with --json', async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(new URL('cli-review-', work).pathname);
  const exec = async (args: string[]) =>
    (
      await promisify(execFile)(process.execPath, [new URL('./bin.mjs', import.meta.url).pathname, ...args], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir },
      })
    ).stdout.trim();
  try {
    await mkdir(path.join(dir, 'content'));
    await writeFile(path.join(dir, 'content/post.md'), 'Onboarding is not a checklist. It is a promise.\n');
    await writeFile(
      path.join(dir, 'proofmarks.config.json'),
      JSON.stringify({
        version: 1,
        roots: ['content'],
        documents: [{ id: 'post', source: 'content/post.md', review: 'reviews/post.json', write: true }],
        judge: { provider: 'fake', model: 'fixture-1' },
      }),
    );
    const human = await exec(['review', 'content/post.md', '--cache-dir', path.join(dir, 'cache')]);
    assert.match(human, /^Reviewed content\/post\.md: \d+ marks? \(fake judge: test data, not real judgments\)$/);
    const lines = (await exec(['review', 'content/post.md', '--json', '--cache-dir', path.join(dir, 'cache')]))
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(lines.at(-1).reviewed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reviewing a lone file with no project saves its review beside it, not a folder up', async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(new URL('cli-lone-', work).pathname);
  try {
    await mkdir(path.join(dir, 'site'));
    await writeFile(path.join(dir, 'site/page.md'), 'We leverage robust tools.\n');
    await promisify(execFile)(
      process.execPath,
      [
        new URL('./bin.mjs', import.meta.url).pathname,
        'review',
        'page.md',
        '--judge',
        'fake',
        '--cache-dir',
        path.join(dir, 'cache'),
      ],
      {
        cwd: path.join(dir, 'site'),
        env: { PATH: process.env.PATH, HOME: dir },
      },
    );
    const { access } = await import('node:fs/promises');
    await access(path.join(dir, 'site/reviews/page.json'));
    await assert.rejects(access(path.join(dir, 'reviews')), 'nothing written in the parent folder');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--version prints the version alone', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL('./bin.mjs', import.meta.url).pathname,
    '--version',
  ]);
  const pkg = JSON.parse(
    await (await import('node:fs/promises')).readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(stdout.trim(), pkg.version);
});

test('dev --background starts the site and the proxy on their own, and dev --stop ends both', async () => {
  const root = await fixture();
  // A free port for the site, which its dev script serves.
  const probe = createNetServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  probe.close();
  await writeFile(
    path.join(root, 'site.mjs'),
    `import { createServer } from 'node:http';
createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><html><body><main><p>A sentence.</p></main></body></html>'); }).listen(${port}, '127.0.0.1');`,
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ private: true, scripts: { dev: 'node site.mjs' } }),
  );
  const config = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
  await writeFile(
    path.join(root, 'proofmarks.config.json'),
    JSON.stringify({ ...config, devServer: `http://127.0.0.1:${port}` }),
  );
  const cli = (...args: string[]) =>
    promisify(execFile)(process.execPath, [new URL('./bin.mjs', import.meta.url).pathname, ...args], { cwd: root });
  try {
    const { stdout } = await cli('dev', '--background', '--judge', 'fake');
    assert.match(stdout, /Starting the site with npm run dev/);
    const address = /Proofmarks dev proxy: (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)?.[1];
    assert.ok(address, stdout);
    assert.equal(await devPage(root), address);
    assert.match(await (await fetch(address)).text(), /A sentence\./, 'the proxy serves the site');
    assert.match((await cli('dev', '--background', '--judge', 'fake')).stdout, /already running/);
    assert.equal(
      (await cli('dev', '--stop')).stdout.trim(),
      'Stopped the Proofmarks dev proxy and the site it started.',
    );
    assert.equal(await devPage(root), undefined);
    await assert.rejects(fetch(address));
    await assert.rejects(fetch(`http://127.0.0.1:${port}`), 'the site stopped too');
    assert.equal((await cli('dev', '--stop')).stdout.trim(), "The Proofmarks dev proxy isn't running.");
  } finally {
    await cli('dev', '--stop').catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a file that can't be read says so, and --help after a command prints the usage", async () => {
  const work = new URL('../../.test-work/', import.meta.url).pathname;
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(path.join(work, 'cli-errors-'));
  const cli = (...args: string[]) =>
    promisify(execFile)(process.execPath, [new URL('./bin.mjs', import.meta.url).pathname, ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir },
    });
  try {
    await assert.rejects(cli('review', 'missing.md', '--judge', 'fake'), (error: { stderr: string }) => {
      assert.match(error.stderr, /Can't read .*missing\.md \(ENOENT\)/);
      assert.doesNotMatch(error.stderr, /Jev/);
      return true;
    });
    assert.match((await cli('review', '--help')).stdout, /^Usage: proofmarks/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
