import { standalone } from './standalone';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { findConfig } from './config';
import { UserError } from './user-error';
import { serve, type ServeOptions } from './server';
import { ownKey } from './keys';
import { envTurnsOff, setOwnersOff } from '../judge/relay';
const live = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const portInUse = (port: number) => `Port ${port} is in use. Pass --port <n> to use another.`;
const portFree = (port: number) =>
  new Promise<boolean>(resolve => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
/** `route` is how the helper judges: with the person's own Jev key, through Torta's relay, or the fake judge. */
type State = { port: number; pid: number; startedAt: string; route?: 'key' | 'relay' | 'fake' };
async function running(root: string): Promise<State | undefined> {
  try {
    const state = JSON.parse(await readFile(path.join(root, '.proofmarks/companion.json'), 'utf8')) as State;
    if (!Number.isInteger(state.pid) || !Number.isInteger(state.port) || !live(state.pid)) return undefined;
    const response = await fetch(`http://127.0.0.1:${state.port}/__proofmarks/session`, {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok || (await response.json()).project !== root) return undefined;
    return state;
  } catch {
    return undefined;
  }
}
/**
 * With your own Jev key, judging never goes through the relay: a helper already judging through it is refused, however
 * this process came to it.
 */
function refuseRelayHelper(state: State | undefined, judge?: string) {
  if (state?.route === 'relay' && judge !== 'fake' && ownKey())
    throw new UserError(
      "Proofmarks is already running for this project and judges through Torta's relay. To judge with your own Jev key, stop it with proofmarks dev --stop, then start it again with TYPESAFE_API_KEY set.",
    );
}
/** For `proofmarks dev --background` finding a dev proxy already running: its helper is checked the same way. */
export async function checkRunningHelper(projectRoot: string, judge?: string) {
  refuseRelayHelper(await running(projectRoot), judge);
}
/**
 * For `proofmarks dev --background` finding a dev proxy already running (`pid`, from .proofmarks/dev.json): when this
 * shell's environment turns usage counts off, the running proxy's helper honors it for as long as that proxy runs, as if
 * this shell had started it. The off lease carries the proxy's pid, so it lapses when the proxy stops.
 */
export async function passOffToRunningDev(projectRoot: string, pid: number) {
  if (!envTurnsOff()) return;
  const leases = path.join(projectRoot, '.proofmarks', 'leases');
  for (const name of await readdir(leases).catch(() => [])) {
    try {
      const lease = JSON.parse(await readFile(path.join(leases, name), 'utf8'));
      if (lease.pid === pid && lease.off === true) return;
    } catch {
      /* Lease was released. */
    }
  }
  try {
    await mkdir(leases, { recursive: true, mode: 0o700 });
    await writeFile(path.join(leases, randomUUID() + '.json'), JSON.stringify({ pid, owner: 'dev', off: true }), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    throw new UserError(
      "Couldn't turn usage counts off for the dev proxy that's already running. Stop it with proofmarks dev --stop, then start it again.",
    );
  }
}
/** For `proofmarks status`: how this project's running helper judges, and whether it sends usage counts. */
export async function helperStatus(projectRoot: string) {
  const state = await running(projectRoot);
  if (!state) return undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/__proofmarks/status`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = (await response.json()) as { usageCounts?: unknown };
    return {
      route: state.route === 'key' ? 'your key' : state.route === 'fake' ? 'fake judge' : "Torta's relay",
      ...(typeof body.usageCounts === 'boolean' ? { usageCounts: body.usageCounts } : {}),
    };
  } catch {
    return undefined;
  }
}
/** Each owner gets a lease; the daemon exits only when every owning process has exited. */
/** `port` is one the person chose, so a taken one is an error; without it the helper prefers `preferredPort` (4848). */
export async function acquireHelper(options: {
  projectRoot: string;
  judge?: string;
  cacheDir?: string;
  port?: number;
  preferredPort?: number;
  owner?: 'mcp' | 'serve' | 'dev';
}) {
  const config = await findConfig(options.projectRoot);
  if (!config) throw new UserError('A project config is required for the helper.');
  const root = config.projectRoot,
    dir = path.join(root, '.proofmarks'),
    leases = path.join(dir, 'leases');
  await mkdir(leases, { recursive: true, mode: 0o700 });
  const lease = path.join(leases, randomUUID() + '.json');
  // A lease says whether this process's environment turns usage counts off, so the shared helper honors it.
  await writeFile(lease, JSON.stringify({ pid: process.pid, owner: options.owner ?? 'mcp', off: envTurnsOff() }), {
    flag: 'wx',
    mode: 0o600,
  });
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await unlink(lease).catch(() => {});
  };
  const onexit = () => {
    void release();
  };
  process.once('exit', onexit);
  try {
    let state = await running(root);
    refuseRelayHelper(state, options.judge);
    if (!state) {
      const lockFile = path.join(dir, 'helper.lock');
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
            if (pid && !live(pid)) await unlink(lockFile).catch(() => {});
          } catch {
            /* Other starter is creating its lock. */
          }
          state = await running(root);
          if (state) break;
          await pause(50);
        }
      }
      if (lock)
        try {
          state = await running(root);
          if (!state) {
            if (options.port && !(await portFree(options.port))) throw new UserError(portInUse(options.port));
            const log = await open(path.join(dir, 'helper.log'), 'a', 0o600);
            try {
              // The standalone program is its own CLI, so it starts the helper with the executable alone.
              const args = [
                ...(standalone
                  ? []
                  : [
                      new URL(import.meta.url.endsWith('.ts') ? './bin.mjs' : '../companion/bin.mjs', import.meta.url)
                        .pathname,
                    ]),
                '_helper',
                '--project',
                root,
                '--judge',
                options.judge ?? config.judge.provider,
                '--port',
                String(options.port ?? options.preferredPort ?? 4848),
              ];
              if (options.port !== undefined) args.push('--strict-port');
              if (options.cacheDir) args.push('--cache-dir', options.cacheDir);
              const child = spawn(process.execPath, args, {
                cwd: root,
                detached: true,
                stdio: ['ignore', log.fd, log.fd],
              });
              child.unref();
              for (let attempt = 0; attempt < 1400 && !state; attempt++) {
                await pause(50);
                state = await running(root);
              }
            } finally {
              await log.close();
            }
          }
        } finally {
          await lock.close();
          await unlink(lockFile).catch(() => {});
        }
    }
    if (!state) throw new UserError('Helper did not start. Check .proofmarks/helper.log.');
    // Another process may have started the helper while this one waited for the lock.
    refuseRelayHelper(state, options.judge);
    return {
      ...state,
      release: async () => {
        process.removeListener('exit', onexit);
        await release();
      },
    };
  } catch (error) {
    process.removeListener('exit', onexit);
    await release();
    throw error;
  }
}
export async function runHelper(options: ServeOptions & { projectRoot: string; strictPort?: boolean }) {
  const config = await findConfig(options.projectRoot);
  if (!config) throw new UserError('Project config required.');
  let server: Awaited<ReturnType<typeof serve>>;
  // A preferred port that's taken falls back to one the system picks, never the next port up: 4849 is the dev proxy's.
  try {
    server = await serve(options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    if (options.strictPort) throw new UserError(portInUse(options.port ?? 4848));
    server = await serve({ ...options, port: 0 });
  }
  const directory = path.join(config.projectRoot, '.proofmarks'),
    file = path.join(directory, 'companion.json');
  const state: State = {
    port: (server.address() as { port: number }).port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    route: options.provider.id === 'fake' ? 'fake' : ownKey() ? 'key' : 'relay',
  };
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    server.close();
    server.closeIdleConnections();
  };
  // Usage counts stay off while any owner's environment turns them off. The leases are read at the moment
  // of each send, so an owner that just attached is honored at once.
  const leases = path.join(directory, 'leases');
  setOwnersOff(() => {
    for (const name of (() => {
      try {
        return readdirSync(leases);
      } catch {
        return [];
      }
    })())
      try {
        const lease = JSON.parse(readFileSync(path.join(leases, name), 'utf8'));
        if (lease.off === true && Number.isInteger(lease.pid) && live(lease.pid)) return true;
      } catch {
        /* Lease was released. */
      }
    return false;
  });
  const owners = async () => {
    let count = 0;
    for (const name of await readdir(leases).catch(() => []))
      try {
        const lease = JSON.parse(await readFile(path.join(leases, name), 'utf8'));
        if (Number.isInteger(lease.pid) && live(lease.pid)) count++;
        else await unlink(path.join(leases, name)).catch(() => {});
      } catch {
        /* Lease was released. */
      }
    return count;
  };
  const timer = setInterval(() => {
    void (async () => {
      if (!(await owners())) stop();
    })();
  }, 500);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.once('close', () => {
    clearInterval(timer);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    void unlink(file).catch(() => {});
  });
  return server;
}
