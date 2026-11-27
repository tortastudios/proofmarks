/**
 * Whether a process is running. Inside an agent's sandbox, signalling a process started elsewhere fails with EPERM,
 * which still means it's there.
 */
export function alive(pid: number, kill: typeof process.kill = (pid, signal) => process.kill(pid, signal)) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
