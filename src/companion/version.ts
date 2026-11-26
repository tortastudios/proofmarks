import { readFileSync } from 'node:fs';
import { standalone, standaloneVersion } from './standalone';

/** Proofmarks' version: from package.json two folders up (src/companion or dist/companion), or built into the standalone program. */
export const version =
  standaloneVersion ??
  (() => {
    try {
      return (
        (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string })
          .version ?? 'unknown'
      );
    } catch {
      return 'unknown';
    }
  })();

/** How this copy was installed, read from where the program lives; only for usage counts, when the person turned them on. */
export function installRoute(executable = process.execPath, isStandalone = standalone) {
  if (!isStandalone) return 'npm';
  if (/[/\\](Cellar|homebrew|linuxbrew)[/\\]/i.test(executable)) return 'homebrew';
  if (/[/\\]\.?proofmarks[/\\]versions[/\\]/i.test(executable)) return 'installer';
  if (/[/\\]site-packages[/\\]/i.test(executable)) return 'python';
  return 'standalone';
}
