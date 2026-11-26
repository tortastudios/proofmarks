// Builds the standalone Proofmarks program for people without Node: Node's single executable format, so it runs the
// same engine and code as the npm package. Run after `pnpm build`. Writes .standalone/proofmarks-<version>-<target>/,
// its archive and the archive's SHA-256.
//
//   node scripts/build-standalone.mjs [--target darwin-arm64|darwin-x64|linux-x64|linux-arm64|win-x64] [--node <path>]
//
// --build-sea needs an official Node build (Homebrew's has single executables off) of the same version as the Node it
// builds into; pass one with --node, or run this script with it. The target defaults to this machine.
// macOS builds are signed with the hardened runtime and the permissions in macos-entitlements.plist, which notarization
// requires and Node's JavaScript engine needs; PROOFMARKS_SIGN_IDENTITY names a Developer ID, otherwise the signature is ad hoc.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const targets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win-x64'];
const host = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const target = option('--target') ?? host;
if (!targets.includes(target)) throw new Error(`Unknown target ${target}; use one of ${targets.join(', ')}`);
const builder = option('--node') ?? process.execPath;
const nodeVersion = execFileSync(builder, ['--version'], { encoding: 'utf8' }).trim();
const windows = target.startsWith('win'),
  work = path.join(root, '.standalone'),
  name = `proofmarks-${pkg.version}-${target}`,
  stage = path.join(work, name);
const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { stdio: 'inherit', ...options });
await rm(stage, { recursive: true, force: true });
await mkdir(work, { recursive: true });

// 1. One ESM file with every dependency in it: the standalone program cannot load code from disk.
const bundle = path.join(work, 'cli.mjs');
await build({
  entryPoints: [path.join(root, 'src/companion/cli.ts')],
  outfile: bundle,
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  // Bundled CommonJS dependencies call require for Node's built-in modules.
  banner: {
    js: "import { createRequire as proofmarksRequire } from 'node:module'; const require = proofmarksRequire(import.meta.url);",
  },
  // init installs this same version of the pi extension from npm (pi always has Node).
  define: { 'process.env.PROOFMARKS_STANDALONE_VERSION': JSON.stringify(pkg.version) },
});

// 2. The official Node binary for the target, checked against the checksums nodejs.org publishes.
async function nodeFor(target) {
  if (target === host && !args.includes('--download')) return builder;
  const file = `node-${nodeVersion}-${target}.${windows ? 'zip' : 'tar.gz'}`,
    directory = path.join(work, 'node', `${nodeVersion}-${target}`);
  const binary = path.join(directory, `node-${nodeVersion}-${target}`, windows ? 'node.exe' : 'bin/node');
  try {
    await readFile(binary);
    return binary;
  } catch {
    /* Not downloaded yet. */
  }
  await mkdir(directory, { recursive: true });
  const base = `https://nodejs.org/dist/${nodeVersion}`;
  const [archive, sums] = await Promise.all([fetch(`${base}/${file}`), fetch(`${base}/SHASUMS256.txt`)]);
  if (!archive.ok || !sums.ok) throw new Error(`Could not download ${file} from nodejs.org`);
  const bytes = Buffer.from(await archive.arrayBuffer()),
    expected = (await sums.text())
      .split('\n')
      .find(line => line.endsWith(`  ${file}`))
      ?.split(' ')[0];
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error(`${file} does not match nodejs.org's SHA-256`);
  await writeFile(path.join(directory, file), bytes);
  if (windows && process.platform !== 'darwin')
    run('unzip', ['-q', file, `node-${nodeVersion}-${target}/node.exe`], { cwd: directory });
  else
    run(
      'tar',
      ['-xf', file, windows ? `node-${nodeVersion}-${target}/node.exe` : `node-${nodeVersion}-${target}/bin/node`],
      { cwd: directory },
    );
  return binary;
}

// 3. The files the package reads beside its code, laid out as in the npm package. The program itself sits at
//    dist/companion/, so the package's own ../../ paths to the rules and the browser assets resolve unchanged.
await cp(path.join(root, 'dist'), path.join(stage, 'dist'), {
  recursive: true,
  filter: source => !/[/\\]dist[/\\](companion|types)([/\\]|$)/.test(source),
});
for (const file of pkg.files.filter(file => file !== 'dist'))
  await cp(path.join(root, file), path.join(stage, file), { recursive: true });
await mkdir(path.join(stage, 'dist/companion'), { recursive: true });

// 4. Inject the bundle into the target's Node. Code cache and snapshots stay off so one machine can build every target.
const executable = path.join(stage, 'dist/companion', windows ? 'proofmarks.exe' : 'proofmarks');
const config = path.join(work, `sea-${target}.json`);
await writeFile(
  config,
  JSON.stringify({
    main: bundle,
    mainFormat: 'module',
    executable: await nodeFor(target),
    output: executable,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  }),
);
run(builder, ['--build-sea', config], { stdio: ['ignore', 'ignore', 'inherit'] });
if (target.startsWith('darwin') && process.platform === 'darwin') {
  const identity = process.env.PROOFMARKS_SIGN_IDENTITY;
  run('codesign', [
    '--sign',
    identity ?? '-',
    '--force',
    '--options',
    'runtime',
    '--entitlements',
    path.join(root, 'scripts/macos-entitlements.plist'),
    ...(identity ? ['--timestamp'] : []),
    executable,
  ]);
}

// 5. A launcher at the top, then the archive and its SHA-256.
if (windows) await writeFile(path.join(stage, 'proofmarks.cmd'), '@"%~dp0dist\\companion\\proofmarks.exe" %*\r\n');
else await symlink('dist/companion/proofmarks', path.join(stage, 'proofmarks'));
const archive = path.join(work, `${name}.${windows ? 'zip' : 'tar.gz'}`);
await rm(archive, { force: true });
if (windows && process.platform !== 'darwin') run('zip', ['-qry', archive, name], { cwd: work });
else run('tar', windows ? ['-a', '-cf', archive, name] : ['-czf', archive, name], { cwd: work });
const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ target, node: nodeVersion, archive: path.relative(root, archive), sha256 }));
