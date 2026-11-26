import { open } from 'node:fs/promises';
/**
 * Every review writer (page decisions, rewrite requests, agent claims and proposals) holds the same lock file
 * for milliseconds. During Rewrite all they overlap constantly, so wait briefly instead of failing the action.
 * Rejects with the original EEXIST error once the wait is over.
 * @param {string} file
 * @param {number} [mode]
 */
export async function acquireReviewLock(file, mode = 0o600, waitMs = 3000) {
  const deadline = Date.now() + waitMs;
  for (let delay = 5; ; delay = Math.min(delay * 2, 50)) {
    try {
      return await open(file, 'wx', mode);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST' || Date.now() >= deadline) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
