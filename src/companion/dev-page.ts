import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { alive } from './alive';
import { childEnv } from './keys';
import { UserError } from './user-error';

/**
 * Where `proofmarks dev` is serving the page, so an agent can open it for the person. The dev command writes
 * .proofmarks/dev.json when its proxy starts and removes it when it stops; a record whose process is gone is ignored.
 */
type DevRecord = { port: number; pid: number; to: string };
const recordFile = (projectRoot: string) => path.join(projectRoot, '.proofmarks', 'dev.json');

export async function recordDevPage(projectRoot: string, record: DevRecord) {
  await mkdir(path.dirname(recordFile(projectRoot)), { recursive: true, mode: 0o700 });
  await writeFile(recordFile(projectRoot), JSON.stringify(record) + '\n', { mode: 0o600 });
}

export async function clearDevPage(projectRoot: string) {
  await rm(recordFile(projectRoot), { force: true });
}

// The signal is a parameter so tests can stand in for an agent's sandbox.
type Kill = typeof process.kill;
const kill: Kill = (pid, signal) => process.kill(pid, signal);
// Inside an agent's sandbox, a process started elsewhere can't be stopped: say where to stop it instead.
function stop(pid: number, signal: Kill) {
  try {
    signal(pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM')
      throw new UserError(
        "Can't stop proofmarks dev from inside this sandbox. Run proofmarks dev --stop in your terminal.",
      );
    throw error;
  }
}

async function devRecord(projectRoot: string, signal: Kill) {
  try {
    const record = JSON.parse(await readFile(recordFile(projectRoot), 'utf8')) as Partial<DevRecord>;
    if (!Number.isInteger(record.port) || !Number.isInteger(record.pid) || !alive(record.pid!, signal))
      return undefined;
    return record as DevRecord;
  } catch {
    return undefined;
  }
}
/** The running `proofmarks dev` for this project: its proxy's address and its pid. */
export async function runningDev(projectRoot: string, signal = kill) {
  const record = await devRecord(projectRoot, signal);
  return record && { address: `http://127.0.0.1:${record.port}`, pid: record.pid };
}
/** The proxy's address if `proofmarks dev` is running for this project. */
export async function devPage(projectRoot: string) {
  return (await runningDev(projectRoot))?.address;
}

const pattern = (url: string) =>
  new RegExp(
    '^' +
      url
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
const plain = (html: string) =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

/**
 * A page's address on the running site. A configured url with wildcards (init writes /*\/faster-ci* for a post in a
 * subfolder) is a pattern for recognizing pages, not an address. Try the paths its source file suggests, from
 * its folders and file name, keep those the pattern allows, and take the first the site serves with the document's own
 * words in it: some dev servers answer any path with their home page.
 */
export async function pagePath(
  url: string | undefined,
  source: string,
  text: string,
  base: string,
  request: typeof fetch = fetch,
) {
  if (!url) return '/';
  if (!url.includes('*')) return url;
  const stem = path.basename(source, path.extname(source)),
    folders = path
      .dirname(source)
      .split(/[\\/]/)
      .filter(folder => folder && folder !== '.'),
    prefixes = ['', ...folders.map((_, i) => '/' + folders.slice(i).join('/')), ...folders.map(folder => '/' + folder)],
    allowed = pattern(url),
    // An index page is served at its folder.
    candidates = [
      ...new Set(
        prefixes.flatMap(prefix =>
          stem === 'index'
            ? [`${prefix}/`, `${prefix}/index.html`]
            : [`${prefix}/${stem}/`, `${prefix}/${stem}`, `${prefix}/${stem}.html`],
        ),
      ),
    ].filter(candidate => allowed.test(candidate));
  // The longest run of plain words in the document, to tell its page from a fallback; without one, the home page.
  const words = [
    ...text
      .replace(/^---[\s\S]*?\n---\n/, '')
      .matchAll(/(?<![\w'’-])(?:[A-Za-z]{2,}[ \t]+){2,}[A-Za-z]{2,}(?![\w'’-])/g),
  ]
    .map(run => run[0].replace(/\s+/g, ' '))
    .sort((a, b) => b.length - a.length)[0];
  const page = async (at: string) => {
    try {
      const response = await request(new URL(at, base), {
        headers: { accept: 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? plain(await response.text()) : undefined;
    } catch {
      return undefined;
    }
  };
  const home = words ? undefined : await page('/');
  for (const candidate of candidates) {
    const body = await page(candidate);
    if (body !== undefined && (words ? body.includes(words) : body !== home)) return candidate;
  }
  return undefined;
}

/** Stops the `proofmarks dev` running for this project, if one is; resolves to whether one was. */
export async function stopDevPage(projectRoot: string, signal = kill) {
  let record: Partial<DevRecord>;
  try {
    record = JSON.parse(await readFile(recordFile(projectRoot), 'utf8')) as Partial<DevRecord>;
  } catch {
    return false;
  }
  if (!Number.isInteger(record.pid) || !alive(record.pid!, signal)) {
    await clearDevPage(projectRoot);
    return false;
  }
  stop(record.pid!, signal);
  for (let attempt = 0; attempt < 100 && alive(record.pid!, signal); attempt++) await pause(50);
  await clearDevPage(projectRoot);
  return true;
}

const siteFile = (projectRoot: string) => path.join(projectRoot, '.proofmarks', 'site.json');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Whether anything answers at an address, whatever its status. */
export async function answers(url: string, request: typeof fetch = fetch) {
  try {
    await request(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the site's development server on its own, for `proofmarks dev --background` when the site isn't running: an
 * agent's commands end with its session, and so would a server it started. Its output goes to
 * .proofmarks/site.log. Resolves to whether the site answers at its address within a minute.
 */
export async function startSite(projectRoot: string, to: string, command: string) {
  await mkdir(path.dirname(siteFile(projectRoot)), { recursive: true, mode: 0o700 });
  const log = await open(path.join(projectRoot, '.proofmarks', 'site.log'), 'a', 0o600);
  try {
    // The site never needs the person's Jev key.
    const child = spawn(command, {
      cwd: projectRoot,
      shell: true,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env: childEnv(),
    });
    child.unref();
    await writeFile(siteFile(projectRoot), JSON.stringify({ pid: child.pid }) + '\n', { mode: 0o600 });
    for (let attempt = 0; attempt < 600 && child.exitCode === null; attempt++) {
      if (await answers(to)) return true;
      await pause(100);
    }
    return answers(to);
  } finally {
    await log.close();
  }
}

/** Stops a site that `proofmarks dev --background` started, with everything it started; resolves to whether one was running. */
export async function stopSite(projectRoot: string) {
  let pid: unknown;
  try {
    pid = (JSON.parse(await readFile(siteFile(projectRoot), 'utf8')) as { pid?: unknown }).pid;
  } catch {
    return false;
  }
  if (typeof pid !== 'number' || !Number.isInteger(pid) || !alive(pid)) {
    await rm(siteFile(projectRoot), { force: true });
    return false;
  }
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  // It was started in its own process group: stopping the group stops the server the shell and npm started too.
  else stop(-pid, kill);
  await rm(siteFile(projectRoot), { force: true });
  for (let attempt = 0; attempt < 100 && alive(pid); attempt++) await pause(50);
  return true;
}

/** Opens an address in the person's default browser. */
export function openInBrowser(url: string) {
  const child = spawn(
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open',
    process.platform === 'win32' ? ['/c', 'start', '', url] : [url],
    { stdio: 'ignore', detached: true },
  );
  child.on('error', () => {});
  child.unref();
}
