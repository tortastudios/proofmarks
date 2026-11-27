import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { childEnv } from './keys';
import { saveTelemetry, telemetryFile, telemetryState } from '../judge/relay';
import { telemetryStatus } from './telemetry';
import { UserError } from './user-error';
import { atomicJson } from './state';
import { standalone, standaloneCommand, standaloneVersion } from './standalone';
import { loadConfig } from '../config/index';
import { inferFormat, type Format } from '../adapters/index';
import { runCommand } from '../agents/command';
import { projectRelative } from './paths';
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const exists = async (file: string) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
/**
 * pi gets the Proofmarks extension rather than an MCP entry: it connects each session itself and pushes the session's
 * requests into it. An MCP entry named proofmarks would take the extension's place, so init names it.
 */
/**
 * pi loads the Proofmarks extension from the project's npm package. The standalone program has no package folder pi can
 * load, but pi always runs on Node, so it installs the extension for its own version from npm.
 */
export async function installPi(
  root: string,
  home: string,
  run: (command: string, args: string[], cwd: string) => Promise<string>,
  print: (message: string) => void,
  version?: string,
) {
  const local = path.join(root, 'node_modules', '@tortastudios', 'proofmarks');
  const source = version ? `npm:@tortastudios/proofmarks@${version}` : './node_modules/@tortastudios/proofmarks',
    command = `pi install -l ${source}`;
  const json = async (file: string) => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as {
        packages?: (string | { source?: string })[];
        mcpServers?: object;
      };
    } catch {
      return undefined;
    }
  };
  const sources = ((await json(path.join(root, '.pi', 'settings.json')))?.packages ?? [])
    .map(entry => (typeof entry === 'string' ? entry : entry.source))
    .filter((entry): entry is string => !!entry);
  // Other versions from npm, left by an earlier standalone init, give way to this one.
  const older = version
    ? sources.filter(entry => entry.startsWith('npm:@tortastudios/proofmarks') && entry !== source)
    : [];
  if (sources.some(entry => (version ? entry === source : path.resolve(root, '.pi', entry) === local)))
    print('pi: Proofmarks extension already installed; unchanged.');
  else if (!version && !(await exists(local)))
    print(`pi: after installing Proofmarks in this project, run: ${command}`);
  else {
    try {
      for (const entry of older) await run('pi', ['remove', '-l', entry], root);
      await run('pi', ['install', '-l', source], root);
      print('pi: installed the Proofmarks extension; rewrite requests arrive in the session.');
    } catch (error) {
      // Say why, so whoever reads this (often an agent) knows what to run.
      const failure = error as { code?: string; stdout?: string; stderr?: string };
      print(
        failure.code === 'ENOENT'
          ? `pi: not on this PATH, so the extension isn't installed. To install it, run: ${command}`
          : /not trusted/i.test(`${failure.stderr ?? ''}${failure.stdout ?? ''}`)
            ? `pi: pi hasn't trusted this project yet, so the extension isn't installed. To install it, run: ${command} --approve`
            : `pi: install with: ${command}`,
      );
    }
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
  if (Object.hasOwn((await json(path.join(agentDir, 'mcp.json')))?.mcpServers ?? {}, 'proofmarks'))
    print(
      'pi: an older Proofmarks MCP entry would keep requests from arriving. Remove it with: pi mcp remove proofmarks',
    );
}
// Where common site generators keep their writing; init --content <folder> adds another.
export const CONTENT_FOLDERS = ['content', 'src/content', '_posts', 'posts', 'src/posts', 'blog'];
export type InitOptions = {
  projectRoot: string;
  content?: string[];
  home?: string;
  confirm?: (message: string) => Promise<boolean>;
  /** Accept without a prompt: an agent setting Proofmarks up for the person runs init --yes. */
  yes?: boolean;
  /** The person's answer about usage counts; init asks only at a terminal, and --yes never answers it. */
  askCounts?: (message: string) => Promise<boolean>;
  print?: (message: string) => void;
  run?: (command: string, args: string[], cwd: string) => Promise<string>;
};
async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  if (!(await exists(directory))) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', '__pycache__', 'venv'].includes(entry.name))
      continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(file)));
    else if (entry.isFile() && /\.(?:md|mdx|html?|jinja2?|j2|njk|nunjucks|twig|liquid)$/.test(file)) files.push(file);
  }
  return files.sort();
}
export async function detectStack(root: string) {
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } = {};
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    /* Non-JS project. */
  }
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const jekyll = await exists(path.join(root, '_config.yml')),
    hugo = (await exists(path.join(root, 'hugo.toml'))) || (await exists(path.join(root, 'hugo.yaml')));
  const stack = dependencies.next
    ? 'next'
    : dependencies.astro
      ? 'astro'
      : dependencies['@11ty/eleventy']
        ? 'eleventy'
        : dependencies.vite
          ? 'vite'
          : jekyll
            ? 'jekyll'
            : hugo
              ? 'hugo'
              : (await exists(path.join(root, 'pyproject.toml'))) && (await exists(path.join(root, 'templates')))
                ? 'jinja'
                : pkg.scripts?.dev
                  ? 'node'
                  : 'static';
  // A dev script that names its own address wins over the framework's default (a Vite site ran on 3764).
  const scripted = scriptAddress(['next', 'astro', 'eleventy', 'vite', 'node'].includes(stack) ? pkg.scripts?.dev : '');
  const port =
    scripted.port ??
    (
      { next: 3000, astro: 4321, eleventy: 8080, vite: 5173, jekyll: 4000, hugo: 1313, node: 3000 } as Record<
        string,
        number
      >
    )[stack] ??
    8000;
  const command =
    stack === 'jinja'
      ? 'uvicorn main:app --reload'
      : stack === 'jekyll'
        ? 'bundle exec jekyll serve'
        : stack === 'hugo'
          ? 'hugo server'
          : stack === 'static'
            ? 'python3 -m http.server 8000'
            : 'npm run dev';
  return {
    stack,
    devServer: `http://${scripted.host ?? 'localhost'}:${port}`,
    command,
    jekyll,
    ...(dependencies.velite ? { rebuild: 'npx velite' } : {}),
  };
}
/** The address a dev script asks for, such as `vite --host 127.0.0.1 --port 3764` or `next dev -p 3001`. */
export function scriptAddress(script = '') {
  const port = /(?:--port[=\s]+|(?:^|\s)-p\s+|\bPORT=)(\d{2,5})\b/.exec(script)?.[1];
  const host = /(?:--host(?:name)?[=\s]+|(?:^|\s)-H\s+)([\w.:-]+)/.exec(script)?.[1];
  return { port: port ? Number(port) : undefined, host: host && host !== '0.0.0.0' ? host : undefined };
}
export async function init(options: InitOptions) {
  const root = path.resolve(options.projectRoot),
    home = options.home ?? homedir();
  const print = options.print ?? console.log;
  // Without a terminal there's no one to answer, so init changes nothing unless it was run with --yes.
  let unanswered = false;
  const confirm =
    options.confirm ??
    (async (message: string) => {
      if (options.yes) return true;
      if (!process.stdin.isTTY) {
        unanswered = true;
        return false;
      }
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^y(es)?$/i.test((await prompt.question(message + ' [y/N] ')).trim());
      } finally {
        prompt.close();
      }
    });
  const run =
    options.run ??
    (async (command: string, args: string[], cwd: string) =>
      (await runCommand(command, args, { cwd, env: childEnv() })).stdout);
  const configFile = path.join(root, 'proofmarks.config.json');
  const present = await exists(configFile);
  if (present) await loadConfig(root);
  const before = present ? await readFile(configFile, 'utf8') : undefined;
  const detected = await detectStack(root);
  type Document = { id: string; source: string; review: string; write: boolean; url?: string; format?: Format };
  const current = before
    ? (JSON.parse(before) as {
        version: 1;
        documents: Document[];
        roots: string[];
        judge: { provider: string; model: string };
        devServer?: string;
        rebuild?: string;
        origins?: string[];
        tailnetHosts?: string[];
        tailscaleUsers?: string[];
      })
    : undefined;
  const extra = (options.content ?? []).map(folder => projectRelative(root, path.resolve(root, folder)));
  for (const folder of extra)
    if (!folder || folder.startsWith('..') || path.isAbsolute(folder) || !(await exists(path.join(root, folder))))
      throw new UserError(`No folder ${folder || '.'} inside the project`);
  const folders = [...new Set([...extra, ...CONTENT_FOLDERS])];
  const found = (
    await Promise.all([...folders, 'templates'].map(folder => markdownFiles(path.join(root, folder))))
  ).flat();
  const files = [
    ...new Set([...found, ...((await exists(path.join(root, 'index.html'))) ? [path.join(root, 'index.html')] : [])]),
  ].sort();
  if (!files.length && !current)
    throw new UserError(
      `No writing found in ${CONTENT_FOLDERS.join(', ')}, templates or index.html. Point init at your folder: proofmarks init --content <folder>`,
    );
  // Jekyll publishes every folder without a leading underscore, so its reviews stay out of the site.
  const reviewDir = (await exists(path.join(root, 'content')))
    ? 'content/reviews'
    : detected.jekyll
      ? '_reviews'
      : 'reviews';
  const used = new Set(current?.documents.map(entry => entry.id));
  const reviewPaths = new Set(current?.documents.map(entry => path.resolve(root, entry.review)));
  const additions: Document[] = [];
  for (const file of files) {
    const relative = projectRelative(root, file);
    if (current?.documents.some(entry => path.resolve(root, entry.source) === file)) continue;
    const folder = folders.filter(folder => relative.startsWith(folder + '/')).sort((a, b) => b.length - a.length)[0];
    const inner = folder ? relative.slice(folder.length + 1) : relative;
    let id = inner.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '-');
    if (relative.startsWith('content/essays/')) id = id.replace(/^essays-/, '');
    if (!/^[a-zA-Z0-9]/.test(id)) id = 'document-' + id;
    const review = `${reviewDir}/${id}.json`;
    if (reviewPaths.has(path.resolve(root, review)))
      throw new UserError('Detected review paths collide; create the config manually');
    reviewPaths.add(path.resolve(root, review));
    if (used.has(id)) throw new UserError('Detected document identities collide; create the config manually');
    used.add(id);
    const format = detected.stack === 'jinja' && relative.startsWith('templates/') ? 'jinja' : inferFormat(file);
    // A Markdown page bundle is named for its folder: content/posts/first-week/index.md like content/posts/first-week.md.
    const name = path.basename(file, path.extname(file)),
      bundle = name === 'index' && folder !== undefined && inner.includes('/'),
      within = bundle ? path.posix.dirname(inner) : inner;
    // Jekyll names posts 2026-11-12-title.md and serves them at a dated /title.html URL.
    const stem = bundle ? path.posix.basename(within) : name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    // A plain HTML page is served at its own path, and an index page at its folder's: blog/first-week/index.html
    // at /blog/first-week/.
    const served =
      format === 'html' && !relative.startsWith('templates/')
        ? relative.replace(/(^|\/)index\.html?$/i, '$1').replace(/\.html?$/i, '')
        : '';
    // A post in a subfolder (src/content/blog/x.md) is usually served under a section, such as /blog/x/.
    additions.push({
      id,
      source: relative,
      review,
      url: served
        ? `/${served}*`
        : stem === 'index'
          ? '/'
          : within.includes('/') || folder === '_posts'
            ? `/*/${stem}*`
            : `/${stem}*`,
      format,
      write: true,
    });
  }
  if (!current || additions.length) {
    const roots = [...new Set([...(current?.roots ?? []), ...additions.map(entry => path.dirname(entry.source))])];
    print(`Detected ${additions.length} new documents in ${roots.join(', ')}`);
    if (!(await confirm('Write proofmarks.config.json and register Proofmarks with installed agents?'))) {
      print(
        unanswered
          ? "Init needs a yes to write proofmarks.config.json, and there's no one here to answer, so nothing changed. To accept without a prompt (as an agent setting Proofmarks up for you would), run proofmarks init --yes."
          : 'Init cancelled; no files changed.',
      );
      return;
    }
    const next = {
      ...current,
      version: 1,
      devServer: current?.devServer ?? detected.devServer,
      origins: current?.origins ?? [],
      tailnetHosts: current?.tailnetHosts ?? [],
      tailscaleUsers: current?.tailscaleUsers ?? [],
      ...(current?.rebuild || detected.rebuild ? { rebuild: current?.rebuild ?? detected.rebuild } : {}),
      documents: [...(current?.documents ?? []), ...additions],
      roots,
      judge: current?.judge ?? { provider: 'jev', model: 'jev-1.14.0' },
    };
    await mkdir(path.join(root, reviewDir), { recursive: true });
    if (before !== undefined) {
      if ((await readFile(configFile, 'utf8')) !== before) throw new UserError('Config changed during init; retry');
      await atomicJson(configFile, next);
    } else await writeFile(configFile, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
  } else print('Existing Proofmarks config is valid; unchanged.');
  for (const agent of [
    { command: 'claude', config: '.claude.json' },
    { command: 'codex', config: '.codex/config.toml' },
    { command: 'pi', config: '.pi/agent' },
  ]) {
    let installed = await exists(path.join(home, agent.config)),
      onPath = false;
    try {
      await run(agent.command, ['--version'], root);
      installed = onPath = true;
    } catch {
      /* Config detection also supports a CLI absent from PATH. */
    }
    if (!installed) continue;
    if (agent.command === 'pi') {
      await installPi(root, home, run, print, standalone ? (standaloneVersion ?? 'latest') : undefined);
      continue;
    }
    const args = [
      'mcp',
      'add',
      'proofmarks',
      '--',
      ...(standalone ? [standaloneCommand()] : ['npx', '--no-install', 'proofmarks']),
      'mcp',
      '--project',
      root,
    ];
    const command = [agent.command, ...args].map(quote).join(' ');
    // Its settings are here but the command isn't: nothing to connect through, and nothing wrong.
    if (!onPath) {
      print(`${agent.command}: not on this PATH, so not connected. To connect it, run: ${command}`);
      continue;
    }
    try {
      const registration = await run(agent.command, ['mcp', 'get', 'proofmarks'], root);
      if (registration.includes(root) && registration.includes('proofmarks')) {
        print(`${agent.command}: Proofmarks already registered; unchanged.`);
        continue;
      }
      print(`${agent.command}: existing registration needs review. Run: ${command}`);
      continue;
    } catch {
      /* No existing registration; add through the agent's CLI. */
    }
    try {
      await run(agent.command, args, root);
      print(`${agent.command}: registered Proofmarks MCP.`);
    } catch {
      print(`${agent.command}: register with: ${command}`);
    }
  }
  print(
    'Rewrites: choose who writes them in a proof card. To use an agent you are working with, ask it to "watch Proofmarks" (in Claude Code, /mcp__proofmarks__watch).',
  );
  print(
    "Reviews use Jev through Torta's relay, so there's no key to set up. To use your own Jev key directly, set TYPESAFE_API_KEY.",
  );
  // Usage counts are the person's call, never an agent's: --yes doesn't answer this, and the setup skill has the agent
  // ask instead. A saved choice isn't asked again.
  const counts = telemetryFile(home),
    ask =
      options.askCounts ??
      (!options.yes && process.stdin.isTTY
        ? async (message: string) => {
            const prompt = createInterface({ input: process.stdin, output: process.stdout });
            try {
              return /^y(es)?$/i.test((await prompt.question(message + ' (y/N) ')).trim());
            } finally {
              prompt.close();
            }
          }
        : undefined);
  if (ask && telemetryState(process.env, counts).by === 'default') {
    print('Everything usage counts send: https://github.com/tortastudios/proofmarks/blob/main/TELEMETRY.md');
    const on = await ask(
      'Help tune the rules for everyone? This sends counts of the marks you keep or dismiss (never your writing), and one count for this install with its version, system and where you found Proofmarks.',
    );
    await saveTelemetry(on, counts);
    print(
      on
        ? 'Usage counts are on. Thank you, they help tune the rules for everyone.'
        : 'Usage counts are off. Proofmarks still tunes its rules to your site on this machine.',
    );
  } else print(telemetryStatus(telemetryState(process.env, counts)));
  const devServer = current?.devServer ?? detected.devServer;
  print(`Quick start (${detected.stack}):\n${detected.command}\nproofmarks dev --to ${devServer}`);
  print('Script-tag alternative (development only; start proofmarks serve):');
  if (detected.stack === 'next')
    print(
      '{process.env.NODE_ENV === "development" && <script src="http://127.0.0.1:4848/__proofmarks/script.js" defer />}',
    );
  else if (detected.stack === 'jinja')
    print(
      '{% if debug %}<script src="http://127.0.0.1:4848/__proofmarks/script.js" defer></script>{% endif %} (pass debug only in development)',
    );
  else
    print(
      "<script>if (['localhost','127.0.0.1','[::1]'].includes(location.hostname)) { const s=document.createElement('script'); s.src='http://127.0.0.1:4848/__proofmarks/script.js'; document.head.append(s); }</script>",
    );
  print(
    'Optional React development wrapper (see https://github.com/tortastudios/proofmarks/blob/main/docs/integrations.md):',
  );
  print(
    `import { Proofmarks } from '@tortastudios/proofmarks/react';\n<Proofmarks reviewId="your-document-id" rootSelector="#main-content" />`,
  );
}
