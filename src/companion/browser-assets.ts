import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url));
const hint = "Proofmarks couldn't build its page script. Run npm run build:browser in the package.";
export const browserScriptFallback = `console.warn(${JSON.stringify(hint)});`;
const fontFallback = `${browserScriptFallback}\nexport const handwritingFont = '';`;
const builds = new Map<string, Promise<void>>();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type BuildOptions = {
  packageRoot?: string;
  resolveBundler?: (root: string) => void;
  log?: (line: string) => void;
};
async function newestSource(directory: string): Promise<number> {
  let newest = 0;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      newest = Math.max(newest, entry.isDirectory() ? await newestSource(file) : (await stat(file)).mtimeMs);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return newest;
}
async function needsBuild(root: string) {
  try {
    const files = new Set(['script.js', 'proofmarks-font.js']);
    try {
      const manifest = JSON.parse(await readFile(path.join(root, 'dist/sizes.json'), 'utf8')) as { file: string }[];
      for (const entry of manifest) if (/^(?:overlay\/)?[a-zA-Z0-9.-]+\.js$/.test(entry.file)) files.add(entry.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const outputs = await Promise.all([...files].map(file => stat(path.join(root, 'dist', file))));
    let builderModified = 0;
    try {
      builderModified = (await stat(path.join(root, 'scripts/build-browser.mjs'))).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const newest = Math.max(builderModified, await newestSource(path.join(root, 'src/overlay')));
    return outputs.some(output => !output.isFile()) || Math.min(...outputs.map(output => output.mtimeMs)) < newest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}
function build(root: string) {
  return new Promise<void>((resolve, reject) => {
    // The package build owns its output paths. No package-manager/install hook is run.
    const child = spawn(process.execPath, [path.join(root, 'scripts/build-browser.mjs')], {
      cwd: root,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 60000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Browser build could not start'));
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Browser build failed'));
    });
  });
}
async function prepare(root: string, options: BuildOptions) {
  // Published installs ship assets and contain no source or build-time dependencies.
  try {
    if (!(await stat(path.join(root, 'src/overlay'))).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!(await needsBuild(root))) return;
  const log = options.log ?? (line => console.error(line));
  try {
    (
      options.resolveBundler ??
      (directory => {
        createRequire(path.join(directory, 'package.json')).resolve('esbuild');
      })
    )(root);
  } catch {
    log('[Proofmarks] Browser builder unavailable; using prebuilt assets or the setup hint.');
    return;
  }
  const output = path.join(root, 'dist');
  await mkdir(output, { recursive: true });
  const lockFile = path.join(output, '.build.lock');
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 1400; attempt++) {
    try {
      lock = await open(lockFile, 'wx', 0o600);
      await lock.writeFile(String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const pid = Number(await readFile(lockFile, 'utf8'));
        let dead = false;
        if (Number.isInteger(pid) && pid > 0)
          try {
            process.kill(pid, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
          }
        if (dead || (!pid && Date.now() - (await stat(lockFile)).mtimeMs > 70000))
          await unlink(lockFile).catch(() => {});
      } catch {
        /* The other builder may have released its lock. */
      }
      await pause(50);
    }
  }
  if (!lock) {
    log('[Proofmarks] Browser builder is busy; using prebuilt assets or the setup hint.');
    return;
  }
  try {
    // Another helper may have completed the same build while this one waited.
    if (await needsBuild(root)) {
      log('[Proofmarks] Building the page script.');
      await build(root).catch(() => {});
    }
  } finally {
    await lock.close();
    await unlink(lockFile).catch(() => {});
  }
}
/** Shared package lock across projects/processes; only helper startup invokes this. */
export async function prepareBrowserAssets(options: BuildOptions = {}) {
  const root = path.resolve(options.packageRoot ?? packageDirectory);
  let pending = builds.get(root);
  if (!pending) {
    pending = prepare(root, options).finally(() => {
      builds.delete(root);
    });
    builds.set(root, pending);
  }
  // A read-only published install can still use its prebuilt files.
  await pending.catch(() => {});
  const read = async (file: string, fallback: string) => {
    try {
      return await readFile(path.join(root, 'dist', file));
    } catch {
      return fallback;
    }
  };
  const modules: Record<string, string> = {};
  for (const file of await readdir(path.join(root, 'dist')).catch(() => [])) {
    if (/^(?:chunk-[A-Z0-9]+|script-entry|index)\.js$/.test(file))
      modules[file] = (await read(file, browserScriptFallback)).toString();
  }
  return {
    script: await read('script.js', browserScriptFallback),
    font: await read('proofmarks-font.js', fontFallback),
    modules,
  };
}
