// Checks a standalone Proofmarks archive the way someone without Node would use it: extract it, then run it with a PATH
// that has no node, npm or agent CLIs and an empty HOME. Covers the CLI, a fake-judge review, init, the dev proxy (which
// starts the helper as its own process) and the MCP server.
//
//   node scripts/smoke-standalone.mjs .standalone/proofmarks-<version>-<target>.tar.gz   (or the .zip on Windows)
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const archive = path.resolve(process.argv[2] ?? '');
assert.match(archive, /proofmarks-.+\.(tar\.gz|zip)$/, 'Pass an archive built by build-standalone.mjs');
const windows = process.platform === 'win32',
  system = process.env.SystemRoot ?? 'C:\\Windows';
const root = path.resolve(import.meta.dirname, '..'),
  work = path.join(root, '.test-work');
await mkdir(work, { recursive: true });
const sandbox = await mkdtemp(path.join(work, 'standalone-')),
  home = path.join(sandbox, 'home');
await mkdir(home);
// Windows' own tar reads zip files (Git's, often first on PATH, does not).
execFileSync(windows ? path.join(system, 'System32', 'tar.exe') : 'tar', ['-xf', archive, '-C', sandbox]);
const unpacked = path.join(sandbox, path.basename(archive).replace(/\.(tar\.gz|zip)$/, ''));
// The top-level launcher on macOS and Linux; on Windows the program itself, since a .cmd file needs a shell.
const program = windows
  ? path.join(unpacked, 'dist', 'companion', 'proofmarks.exe')
  : path.join(unpacked, 'proofmarks');
// No node, npm, npx or agent CLIs: only the system's own directories.
const env = windows
  ? {
      PATH: [path.join(system, 'System32'), system, path.join(system, 'System32', 'Wbem')].join(';'),
      PATHEXT: process.env.PATHEXT,
      SystemRoot: system,
      windir: system,
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    }
  : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' };
// The static example's server: python3 from the system on macOS and Linux; on Windows, the first real python on PATH.
const python = windows
  ? execFileSync('where', ['python'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line && !line.includes('WindowsApps'))
  : 'python3';
assert.throws(
  () => execFileSync('node', ['--version'], { env, stdio: 'ignore' }),
  'node must not be on the smoke PATH',
);
const proofmarks = (args, cwd) =>
  execFileSync(program, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const children = new Set();
const start = (command, args, cwd, extra = {}) => {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extra },
    stdio: 'ignore',
    detached: !windows,
    windowsHide: true,
  });
  children.add(child);
  return child;
};
const freePort = async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  return port;
};
async function ready(url) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* Starting. */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
const results = {};
try {
  assert.match(proofmarks(['--help']), /Usage: proofmarks/);
  results.cli = 'pass';
  const gallery = path.join(sandbox, 'gallery');
  await cp(path.join(root, 'examples/gallery'), gallery, { recursive: true });
  assert.match(
    proofmarks(['review', 'pieces/essay.md', '--judge', 'fake'], gallery),
    /^Reviewed pieces\/essay\.md: \d+ marks/,
  );
  results.review = 'pass';
  assert.match(proofmarks(['init'], gallery), /Existing Proofmarks config is valid/);
  // With agent CLIs installed, init registers the program itself with claude, never npx, and installs this version's pi
  // extension from npm. Stubs record what they were asked: shell scripts on macOS and Linux, and on Windows
  // .cmd files like the ones npm installs.
  const stubs = path.join(sandbox, 'stub-bin'),
    calls = { claude: path.join(sandbox, 'claude-calls.txt'), pi: path.join(sandbox, 'pi-calls.txt') };
  await mkdir(stubs);
  for (const [name, log] of Object.entries(calls)) {
    if (windows)
      await writeFile(
        path.join(stubs, `${name}.cmd`),
        `@echo off\r\necho %*>> "${log}"\r\nif "%~1 %~2"=="mcp get" exit /b 1\r\nexit /b 0\r\n`,
      );
    else {
      await writeFile(
        path.join(stubs, name),
        `#!/bin/sh\necho "$*" >> '${log}'\ncase "$1 $2" in "mcp get") exit 1;; esac\nexit 0\n`,
      );
      await chmod(path.join(stubs, name), 0o755);
    }
  }
  execFileSync(program, ['init'], {
    cwd: gallery,
    env: { ...env, PATH: `${stubs}${path.delimiter}${env.PATH}` },
    stdio: 'ignore',
  });
  // Windows passes each argument quoted.
  const asked = async name => (await readFile(calls[name], 'utf8')).replaceAll('"', '');
  assert.match(
    await asked('claude'),
    new RegExp(`^mcp add proofmarks -- ${program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} mcp --project `, 'm'),
  );
  const version = path.basename(archive).match(/^proofmarks-(.+?)-(?:darwin|linux|win)-/)[1];
  assert.match(
    await asked('pi'),
    new RegExp(`^install -l npm:@tortastudios/proofmarks@${version.replaceAll('.', '\\.')}$`, 'm'),
  );
  results.init = 'pass';
  // The static example needs nothing installed: Python's own server is the site, as it would be for a Python-only user.
  const site = path.join(sandbox, 'static'),
    sitePort = await freePort(),
    proxyPort = await freePort();
  await cp(path.join(root, 'examples/static'), site, { recursive: true });
  start(python, ['-m', 'http.server', String(sitePort), '--bind', '127.0.0.1'], site);
  await ready(`http://127.0.0.1:${sitePort}/`);
  start(program, ['dev', '--to', `http://127.0.0.1:${sitePort}`, '--port', String(proxyPort), '--judge', 'fake'], site);
  const page = await (await ready(`http://127.0.0.1:${proxyPort}/?proof=1`)).text();
  assert.match(page, /__proofmarks\/script\.js/);
  const script = await fetch(`http://127.0.0.1:${proxyPort}/__proofmarks/script.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /import|export|function/);
  results.devProxy = 'pass';
  const client = new Client({ name: 'standalone-smoke', version: '1' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: program,
        args: ['mcp', '--project', gallery, '--judge', 'fake'],
        cwd: gallery,
        env,
        stderr: 'pipe',
      }),
    );
    assert.equal((await client.listTools()).tools.length, 12);
    assert.equal((await client.callTool({ name: 'proofmarks_list_reviews', arguments: {} })).isError, undefined);
  } finally {
    await client.close();
  }
  results.mcp = 'pass';
  console.log(JSON.stringify({ archive: path.relative(root, archive), results }));
} finally {
  // Each child with what it started (the dev proxy starts the helper).
  for (const child of children) {
    try {
      if (windows) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already gone. */
    }
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
