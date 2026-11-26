import { spawn } from 'node:child_process';
import { loadConfig } from '../config/index';
import { childEnv } from '../companion/keys';
/** Config is trusted project code; request bodies never supply commands. */
export async function rebuild(projectRoot: string) {
  const config = await loadConfig(projectRoot);
  const command = config.rebuild;
  if (!command) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: config.projectRoot,
      shell: true,
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      // A project's rebuild command never needs the person's Jev key.
      env: childEnv(),
    });
    const timer = setTimeout(() => {
      if (child.pid)
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
    }, 60000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Rebuild could not start. Check the helper log.'));
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Rebuild failed or timed out. Check the helper log.'));
    });
  });
}
