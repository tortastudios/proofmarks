import { access } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, type ProofmarksConfig } from '../config/index';
/** Find the nearest project configuration without hiding invalid configs. */
export async function findConfig(start: string): Promise<ProofmarksConfig | undefined> {
  let directory = path.resolve(start);
  for (;;) {
    try {
      await access(path.join(directory, 'proofmarks.config.json'));
      return await loadConfig(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
