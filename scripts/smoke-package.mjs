import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, cp, symlink, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const work = path.resolve(process.env.PROOFMARKS_SMOKE_WORK ?? path.join(root, '.test-work'));
await mkdir(work, { recursive: true });
const sandbox = await mkdtemp(path.join(work, 'package-'));
const home = path.join(sandbox, 'home'),
  bin = path.join(sandbox, 'bin');
await mkdir(home);
await mkdir(bin);
await symlink(process.execPath, path.join(bin, 'node'));
const env = {
  ...process.env,
  HOME: home,
  PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
  NEXT_TELEMETRY_DISABLED: '1',
  WATCHPACK_POLLING: 'true',
  UV_CACHE_DIR: path.join(work, 'uv-cache'),
  npm_config_cache: path.join(work, 'npm-cache'),
};
delete env.TYPESAFE_API_KEY;
delete env.PROOFMARKS_SCRATCH_DIR;
async function executable(name) {
  if (path.isAbsolute(name)) {
    await access(name);
    return name;
  }
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try the next directory. */
    }
  }
  throw Error(`${name} is required for the package smoke.`);
}
// Resolve tools before isolating PATH, so installed examples never expose agent CLIs.
const npmPath = await executable(process.env.PROOFMARKS_NPM ?? 'npm');
const uvPath = await executable(process.env.PROOFMARKS_UV ?? 'uv');
const logs = [];
async function run(command, args, cwd = root, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      logs.push({ command: [command, ...args], cwd, output });
      if (code === 0) resolve(output);
      else reject(Error(`${path.basename(command)} failed (${code}): ${output.slice(-3000)}`));
    });
  });
}
const servers = new Set();
function start(command, args, cwd, extra = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });
  child.on('error', error => {
    output += error.message;
  });
  servers.add(child);
  child.output = () => output;
  return child;
}
async function stop(child) {
  if (!child || !servers.has(child)) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* Already exited. */
  }
  await Promise.race([once(child, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* Already exited. */
  }
  servers.delete(child);
}
async function ready(url, child) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error(`Server exited: ${child.output()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch {
      /* Starting. */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${url}: ${child.output()}`);
}
try {
  // Build outside isolated PATH; only the installed tarball runs inside it.
  console.log('Packing the built package.');
  const pack = await new Promise((resolve, reject) => {
    const child = spawn(npmPath, ['pack', '--json', '--pack-destination', sandbox], {
      cwd: root,
      env: { ...process.env, TYPESAFE_API_KEY: undefined, npm_config_cache: path.join(work, 'npm-cache') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      error += chunk;
    });
    child.once('error', reject);
    child.once('close', code => (code === 0 ? resolve(JSON.parse(output)) : reject(Error(error + output))));
  });
  const packed = pack[0];
  // Unpacked size was 695,465 bytes on November 18, 2026, and 700,627 with the pi extension; raise this deliberately.
  assert.ok(packed.unpackedSize < 720000, `Unpacked package is ${packed.unpackedSize} bytes`);
  const packedPaths = new Set(packed.files.map(file => file.path));
  for (const file of JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).pi.extensions)
    assert.ok(packedPaths.has(file.replace(/^\.\//, '')), `Missing pi extension ${file}`);
  for (const entry of Object.values(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).exports)) {
    for (const target of typeof entry === 'string' ? [entry] : Object.values(entry))
      assert.ok(packedPaths.has(target.replace(/^\.\//, '')), `Missing export ${target}`);
  }
  const project = path.join(sandbox, 'consumer');
  await mkdir(project);
  await writeFile(path.join(project, 'package.json'), '{"private":true,"type":"module"}\n');
  await run(npmPath, ['install', '--omit=dev', '--ignore-scripts', path.join(sandbox, packed.filename)], project);
  const installed = path.join(project, 'node_modules/@tortastudios/proofmarks');
  const cli = path.join(installed, 'dist/companion/bin.mjs');
  assert.match(await run(process.execPath, [cli, '--help'], project), /Usage: proofmarks/);
  await assert.rejects(readFile(path.join(project, 'node_modules/tsx/package.json')));
  await assert.rejects(readFile(path.join(project, 'node_modules/esbuild/package.json')));
  await assert.rejects(readFile(path.join(installed, 'src/companion/cli.ts')));
  if (!sandbox.startsWith(root + path.sep))
    await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {createRequire} from 'node:module'; import assert from 'node:assert/strict'; const require=createRequire(import.meta.url); for (const dependency of ['tsx','esbuild']) assert.throws(()=>require.resolve(dependency), {code:'MODULE_NOT_FOUND'});",
      ],
      project,
    );
  assert.ok(!packed.files.some(file => /^(examples|rules\/labeled)\//.test(file.path)));
  await cp(path.join(root, 'examples'), path.join(project, 'examples'), { recursive: true });
  assert.match(await readFile(path.join(installed, 'dist/overlay/react.js'), 'utf8'), /process\.env\.NODE_ENV/);
  const fontFiles = [];
  for (const file of packed.files.filter(file => file.path.endsWith('.js'))) {
    if ((await readFile(path.join(installed, file.path), 'utf8')).includes('data:font/woff2;base64,'))
      fontFiles.push(file.path);
  }
  assert.deepEqual(fontFiles, ['dist/proofmarks-font.js']);
  assert.equal(
    await readFile(path.join(installed, 'LICENSE.md'), 'utf8'),
    await readFile(path.join(root, 'LICENSE.md'), 'utf8'),
  );
  // Existing config exercises init without prompting or touching user agent config.
  const staticRoot = path.join(project, 'examples/static');
  assert.match(await run(process.execPath, [cli, 'init'], staticRoot), /Existing Proofmarks config is valid/);
  await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('@tortastudios/proofmarks/config'); await import('@tortastudios/proofmarks/next'); await import('@tortastudios/proofmarks/overlay');",
    ],
    project,
  );
  // The pi extension loads in plain Node: it uses only pi's types, and pi supplies its own modules at runtime.
  assert.equal(
    await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const pi = await import('./node_modules/@tortastudios/proofmarks/dist/pi/extension.js'); console.log(typeof pi.default);",
      ],
      project,
    ),
    'function\n',
  );
  const sdk = await import(path.join(project, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'));
  const { StdioClientTransport } = await import(
    path.join(project, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')
  );
  const client = new sdk.Client({ name: 'package-smoke', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp', '--project', staticRoot, '--judge', 'fake'],
    cwd: staticRoot,
    env,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 12);
    assert.equal((await client.callTool({ name: 'proofmarks_list_reviews', arguments: {} })).isError, undefined);
  } finally {
    await client.close();
  }
  const results = [];
  for (const [index, name] of ['static', 'vite-html', 'next-mdx', 'fastapi-jinja', 'gallery'].entries()) {
    console.log(`Checking example: ${name}`);
    const cwd = path.join(project, 'examples', name);
    let upstream;
    const config = JSON.parse(await readFile(path.join(cwd, 'proofmarks.config.json'), 'utf8'));
    const port = new URL(config.devServer).port;
    if (name === 'static')
      upstream = start('/usr/bin/python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], cwd);
    else if (name === 'fastapi-jinja') {
      upstream = start(uvPath, ['run', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', port], cwd, {
        APP_ENV: 'development',
      });
    } else {
      // Avoid linking the source package: each example uses the already installed tarball.
      const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
      delete pkg.devDependencies?.['@tortastudios/proofmarks'];
      await writeFile(path.join(cwd, 'package.json'), JSON.stringify(pkg));
      await run(npmPath, ['install', '--ignore-scripts'], cwd);
      const command =
        name === 'vite-html'
          ? path.join(cwd, 'node_modules/vite/bin/vite.js')
          : name === 'next-mdx'
            ? path.join(cwd, 'node_modules/next/dist/bin/next')
            : path.join(cwd, 'server.mjs');
      const args =
        name === 'vite-html'
          ? ['--host', '127.0.0.1', '--port', port]
          : name === 'next-mdx'
            ? ['dev', '--webpack', '--port', port]
            : [];
      upstream = start(process.execPath, [command, ...args], cwd);
    }
    let proxy;
    try {
      await ready(config.devServer, upstream);
      const proxyPort = 14849 + index;
      proxy = start(
        process.execPath,
        [
          cli,
          'dev',
          '--judge',
          'fake',
          '--port',
          String(proxyPort),
          '--cache-dir',
          path.join(cwd, '.proofmarks/cache'),
        ],
        cwd,
      );
      const base = `http://127.0.0.1:${proxyPort}`;
      const html = await (await ready(base + '/?proof=1', proxy)).text();
      assert.match(html, /__proofmarks\/script\.js/);
      assert.match(await (await fetch(base + '/__proofmarks/script.js')).text(), /Proofmarks/);
      for (const file of packed.files.filter(file =>
        /^dist\/(?:chunk-[A-Z0-9]+|index|script-entry)\.js$/.test(file.path),
      )) {
        const response = await fetch(base + '/__proofmarks/' + path.basename(file.path));
        assert.equal(response.status, 200);
        assert.equal(await response.text(), await readFile(path.join(installed, file.path), 'utf8'));
      }
      assert.equal((await fetch(base + '/__proofmarks/constructor')).status, 404);
      const font = await fetch(base + '/__proofmarks/proofmarks-font.js');
      assert.equal(font.status, 200);
      assert.ok((await font.text()).length > 50000);
      const sessionResponse = await fetch(base + '/__proofmarks/session');
      assert.equal(sessionResponse.status, 200);
      const session = await sessionResponse.json();
      for (const document of config.documents) {
        const review = await fetch(base + `/__proofmarks/review?reviewId=${document.id}`);
        assert.equal(review.status, 200);
        assert.ok((await review.json()).findings.length > 0);
        // Exercise the built review pipeline, registry/calibration paths and fake judge.
        const recheck = await fetch(base + '/__proofmarks/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-proofmarks-token': session.token },
          body: JSON.stringify({ reviewId: document.id }),
        });
        assert.equal(recheck.status, 200, await recheck.text());
      }
      results.push({ example: name, proxy: 'pass', reviews: config.documents.length, fakeRecheck: 'pass' });
    } finally {
      await stop(proxy);
      await stop(upstream);
    }
  }
  await writeFile(
    path.join(sandbox, 'RESULTS.json'),
    JSON.stringify(
      {
        package: { bytes: packed.size, unpackedBytes: packed.unpackedSize, files: packed.files.length },
        cli: 'pass',
        init: 'pass',
        mcpTools: 8,
        devDependencies: 'absent',
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({ sandbox, packageBytes: packed.size, unpackedBytes: packed.unpackedSize, results }, null, 2),
  );
} finally {
  for (const child of servers) await stop(child);
  await writeFile(path.join(sandbox, 'commands.json'), JSON.stringify(logs, null, 2) + '\n');
  // Session tokens and logs stay in ignored local scratch, never in committed fixtures.
  await rm(home, { recursive: true, force: true });
}
