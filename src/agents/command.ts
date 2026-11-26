import spawn from 'cross-spawn';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Agent CLIs are found and run the way a shell would. On Windows that means PATHEXT: npm installs codex, pi
 * and sometimes claude as .cmd files, which Node can't start without a shell, and cross-spawn runs them with safe
 * quoting. Elsewhere nothing changes.
 */
export async function findCommand(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const windows = platform === 'win32';
  const extensions = windows ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const directory of (env.PATH ?? env.Path ?? '').split(windows ? ';' : path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const file = path.join(directory, name + extension);
      try {
        await access(file, windows ? constants.F_OK : constants.X_OK);
        if ((await stat(file)).isFile()) return file;
      } catch {
        /* Not here. */
      }
    }
  }
  return undefined;
}

export type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeout?: number;
  maxBuffer?: number;
};

/** Runs a command to completion and returns its output; rejects with its output when it fails. */
export function runCommand(
  command: string,
  args: readonly string[],
  { cwd, env, signal, timeout, maxBuffer = 10_000_000 }: RunOptions,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '',
      stderr = '',
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    };
    const abort = () => {
      child.kill();
      finish(new Error(timeout && !signal?.aborted ? `${command} timed out` : `${command} was cancelled`));
    };
    const timer = timeout ? setTimeout(abort, timeout) : undefined;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdout!.on('data', data => {
      stdout += String(data);
      if (stdout.length > maxBuffer) {
        child.kill();
        finish(new Error(`${command} returned too much output`));
      }
    });
    child.stderr!.on('data', data => {
      stderr = (stderr + String(data)).slice(-maxBuffer);
    });
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 ? undefined : new Error(`${command} exited with ${code}`)));
  });
}
