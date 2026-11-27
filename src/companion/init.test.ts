import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { init, installPi, scriptAddress } from './init';
async function fixture() {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const base = await mkdtemp(new URL('init-', work).pathname);
  const home = path.join(base, 'home'),
    project = path.join(base, 'project');
  await mkdir(home);
  await mkdir(path.join(project, 'content/essays'), { recursive: true });
  await writeFile(path.join(project, 'content/essays/example.mdx'), 'Example.');
  return { base, home, project, close: () => rm(base, { recursive: true }) };
}
// CI runners set CI=true, which keeps usage counts off and skips init's question about them. These tests are about a
// person at a terminal, so they run without the variables that turn counts off, and put them back after.
function withoutCountsOff() {
  const keys = ['CI', 'DO_NOT_TRACK', 'PROOFMARKS_TELEMETRY'];
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) delete process.env[key];
  return () => {
    for (const [key, value] of saved)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };
}

test('init confirms writes, detects content and registers all agents idempotently through stub CLIs', async () => {
  const restore = withoutCountsOff();
  const f = await fixture();
  try {
    const registrations = new Map<string, string>();
    let adds = 0,
      installs = 0,
      confirmations = 0;
    const output: string[] = [];
    await mkdir(path.join(f.project, 'node_modules', '@tortastudios', 'proofmarks'), { recursive: true });
    const options = {
      projectRoot: f.project,
      home: f.home,
      confirm: async () => {
        confirmations++;
        return true;
      },
      print: (message: string) => {
        output.push(message);
      },
      run: async (command: string, args: string[], cwd: string) => {
        assert.equal(cwd, f.project);
        if (args[0] === '--version') return 'stub';
        if (args[1] === 'get') {
          const registration = args[2] === 'proofmarks' ? registrations.get(command) : undefined;
          if (!registration) throw new Error('missing');
          return registration;
        }
        // pi installs the extension and records it the way pi does, relative to .pi/settings.json.
        if (command === 'pi') {
          assert.deepEqual(args, ['install', '-l', './node_modules/@tortastudios/proofmarks']);
          installs++;
          await mkdir(path.join(f.project, '.pi'), { recursive: true });
          await writeFile(
            path.join(f.project, '.pi', 'settings.json'),
            JSON.stringify({ packages: ['../node_modules/@tortastudios/proofmarks'] }),
          );
          return '';
        }
        assert.deepEqual(args.slice(0, 4), ['mcp', 'add', 'proofmarks', '--']);
        registrations.set(command, args.join(' '));
        adds++;
        return '';
      },
    };
    await init(options);
    const first = await readFile(path.join(f.project, 'proofmarks.config.json'), 'utf8');
    await init(options);
    assert.equal(await readFile(path.join(f.project, 'proofmarks.config.json'), 'utf8'), first);
    assert.equal(adds, 2);
    assert.equal(installs, 1);
    assert.equal(confirmations, 1);
    assert.match(output.join('\n'), /pi: installed the Proofmarks extension/);
    assert.match(output.join('\n'), /pi: Proofmarks extension already installed; unchanged\./);
    assert.deepEqual(JSON.parse(first).roots, ['content/essays']);
    assert.equal(JSON.parse(first).documents[0].id, 'example');
    assert.match(output.join('\n'), /ask it to "watch Proofmarks" \(in Claude Code, \/mcp__proofmarks__watch\)/);
    assert.match(output.join('\n'), /Jev through Torta's relay, so there's no key to set up/);
    // Without a person at a terminal, init doesn't ask about usage counts; it says they're off and how to turn them on.
    assert.match(output.join('\n'), /Usage counts are off\. .*run proofmarks telemetry on\./);
    assert.match(output.join('\n'), /Proofmarks reviewId/);
    assert.ok(!first.includes('TYPESAFE_API_KEY'));
  } finally {
    await f.close();
    restore();
  }
});
test('init cancellation writes nothing; unsupported agent CLI prints exact fallback', async () => {
  const f = await fixture();
  try {
    await init({
      projectRoot: f.project,
      home: f.home,
      confirm: async () => false,
      print: () => {},
      run: async () => {
        assert.fail('must not register after cancellation');
      },
    });
    await assert.rejects(readFile(path.join(f.project, 'proofmarks.config.json')));
    await mkdir(path.join(f.home, '.codex'));
    await writeFile(path.join(f.home, '.codex/config.toml'), '# fake agent config\n');
    const output: string[] = [];
    await init({
      projectRoot: f.project,
      home: f.home,
      confirm: async () => true,
      print: line => {
        output.push(line);
      },
      run: async () => {
        throw new Error('CLI absent');
      },
    });
    assert.match(output.join('\n'), /'codex' 'mcp' 'add' 'proofmarks' '--' 'npx'/);
    assert.equal(await readFile(path.join(f.home, '.codex/config.toml'), 'utf8'), '# fake agent config\n');
  } finally {
    await f.close();
  }
});
test('init adds newly discovered documents only after confirmation, preserving existing settings', async () => {
  const f = await fixture();
  try {
    const options = {
      projectRoot: f.project,
      home: f.home,
      confirm: async () => true,
      print: () => {},
      run: async () => {
        throw new Error('no installed CLI');
      },
    };
    await init(options);
    const file = path.join(f.project, 'proofmarks.config.json');
    const previous = JSON.parse(await readFile(file, 'utf8'));
    previous.documents[0].write = false;
    previous.judge.model = 'custom-model';
    await writeFile(file, JSON.stringify(previous));
    await mkdir(path.join(f.project, 'content/notes'));
    await writeFile(path.join(f.project, 'content/notes/new.md'), 'New note.');
    const before = await readFile(file, 'utf8');
    await init({ ...options, confirm: async () => false });
    assert.equal(await readFile(file, 'utf8'), before);
    await init(options);
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(after.documents.length, 2);
    assert.equal(after.documents[0].write, false);
    assert.equal(after.judge.model, 'custom-model');
    assert.ok(after.roots.includes('content/notes'));
    const updated = await readFile(file, 'utf8');
    await init(options);
    assert.equal(await readFile(file, 'utf8'), updated);
  } finally {
    await f.close();
  }
});
test('the standalone program installs the pi extension for its own version from npm, replacing older ones', async () => {
  const f = await fixture();
  try {
    const calls: string[] = [],
      output: string[] = [];
    const run = async (command: string, args: string[]) => {
      calls.push([command, ...args].join(' '));
      return '';
    };
    const settings = (packages: string[]) =>
      mkdir(path.join(f.project, '.pi'), { recursive: true }).then(() =>
        writeFile(path.join(f.project, '.pi/settings.json'), JSON.stringify({ packages })),
      );
    await installPi(
      f.project,
      f.home,
      run,
      line => {
        output.push(line);
      },
      '0.2.0',
    );
    assert.deepEqual(calls, ['pi install -l npm:@tortastudios/proofmarks@0.2.0']);
    await settings(['npm:@tortastudios/proofmarks@0.2.0']);
    calls.length = 0;
    await installPi(
      f.project,
      f.home,
      run,
      line => {
        output.push(line);
      },
      '0.2.0',
    );
    assert.deepEqual(calls, []);
    assert.match(output.at(-1)!, /already installed; unchanged/);
    await settings(['npm:@tortastudios/proofmarks@0.1.0', 'npm:other-extension']);
    await installPi(
      f.project,
      f.home,
      run,
      line => {
        output.push(line);
      },
      '0.2.0',
    );
    assert.deepEqual(calls, [
      'pi remove -l npm:@tortastudios/proofmarks@0.1.0',
      'pi install -l npm:@tortastudios/proofmarks@0.2.0',
    ]);
  } finally {
    await f.close();
  }
});

test('init says why an agent is not connected: not on this PATH, or pi has not trusted the project', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.home, '.codex'), { recursive: true });
    await writeFile(path.join(f.home, '.codex/config.toml'), '');
    await mkdir(path.join(f.home, '.pi/agent'), { recursive: true });
    await mkdir(path.join(f.project, 'node_modules/@tortastudios/proofmarks'), { recursive: true });
    const output: string[] = [];
    const run = async (command: string, args: string[]) => {
      if (command === 'codex') throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      if (command === 'pi' && args[0] === 'install')
        throw Object.assign(new Error('pi exited with 1'), {
          stdout: '',
          stderr: 'Project is not trusted. Use --approve to modify local package config.',
        });
      return '';
    };
    await init({ projectRoot: f.project, home: f.home, yes: true, print: line => output.push(line), run });
    const said = output.join('\n');
    assert.match(said, /codex: not on this PATH, so not connected\. To connect it, run: 'codex' 'mcp' 'add'/);
    assert.match(
      said,
      /pi: pi hasn't trusted this project yet, so the extension isn't installed\. To install it, run: pi install -l \.\/node_modules\/@tortastudios\/proofmarks --approve/,
    );
  } finally {
    await f.close();
  }
});

test('with no one to answer, init changes nothing and says to use --yes; with --yes it writes the config', async () => {
  const f = await fixture();
  try {
    // Tests run without a terminal, as an agent does.
    const output: string[] = [];
    await init({ projectRoot: f.project, home: f.home, print: line => output.push(line), run: async () => '' });
    await assert.rejects(readFile(path.join(f.project, 'proofmarks.config.json')));
    assert.match(output.join('\n'), /no one here to answer, so nothing changed.*proofmarks init --yes/);
    await init({ projectRoot: f.project, home: f.home, yes: true, print: () => {}, run: async () => '' });
    const config = JSON.parse(await readFile(path.join(f.project, 'proofmarks.config.json'), 'utf8'));
    assert.ok(config.documents.length > 0);
  } finally {
    await f.close();
  }
});

test("the site's address comes from its dev script when the script names one", async () => {
  assert.deepEqual(scriptAddress('vite --host 127.0.0.1 --port 3764'), { port: 3764, host: '127.0.0.1' });
  assert.deepEqual(scriptAddress('next dev -p 3001 -H localhost'), { port: 3001, host: 'localhost' });
  assert.deepEqual(scriptAddress('PORT=4000 node server.js'), { port: 4000, host: undefined });
  assert.deepEqual(scriptAddress('astro dev --port=4400 --host 0.0.0.0'), { port: 4400, host: undefined });
  assert.deepEqual(scriptAddress('vite'), { port: undefined, host: undefined });
  assert.deepEqual(scriptAddress('vite build --mode prod-p'), { port: undefined, host: undefined });
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.project, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite --host 127.0.0.1 --port 3764' }, devDependencies: { vite: '7.0.0' } }),
    );
    await init({ projectRoot: f.project, home: f.home, yes: true, print: () => {}, run: async () => '' });
    const config = JSON.parse(await readFile(path.join(f.project, 'proofmarks.config.json'), 'utf8'));
    assert.equal(config.devServer, 'http://127.0.0.1:3764');
  } finally {
    await f.close();
  }
});

test('usage counts: init asks the person once and saves the answer; --yes never answers for them', async () => {
  const restore = withoutCountsOff();
  const f = await fixture();
  try {
    const asked: string[] = [],
      output: string[] = [];
    const base = {
      projectRoot: f.project,
      home: f.home,
      confirm: async () => true,
      print: (message: string) => void output.push(message),
      run: async () => {
        throw new Error('no agents here');
      },
    };
    const counts = path.join(f.home, '.proofmarks', 'telemetry.json');
    await init({ ...base, yes: true });
    await assert.rejects(readFile(counts, 'utf8'), 'an agent running init --yes saves no choice');
    await init({ ...base, askCounts: async message => (asked.push(message), true) });
    assert.deepEqual(asked, [
      'Help tune the rules for everyone? This sends counts of the marks you keep or dismiss (never your writing), and one count for this install with its version, system and where you found Proofmarks.',
    ]);
    assert.equal(JSON.parse(await readFile(counts, 'utf8')).on, true);
    assert.match(output.join('\n'), /Usage counts are on\. Thank you, they help tune the rules for everyone\./);
    await init({ ...base, askCounts: async message => (asked.push(message), false) });
    assert.equal(asked.length, 1, 'a saved choice is not asked again');
  } finally {
    await f.close();
    restore();
  }
});
test('init registers nothing for an agent whose Proofmarks plugin is on, and says when an older registration doubles it', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.home, '.codex'), { recursive: true });
    const codexConfig = (enabled: boolean) =>
      writeFile(
        path.join(f.home, '.codex', 'config.toml'),
        `[marketplaces.tortastudios]\nsource_type = "git"\n\n[plugins."proofmarks@tortastudios"]\nenabled = ${enabled}\n`,
      );
    await codexConfig(true);
    const adds: string[] = [],
      output: string[] = [];
    const run = async (command: string, args: string[]) => {
      if (command === 'pi') throw new Error('absent');
      if (args[0] === '--version') return 'stub';
      if (args[1] === 'get') {
        // Claude Code lists the plugin's server, and an earlier init registered one too.
        if (command === 'claude') return `${args[2]}: npx -y @tortastudios/proofmarks mcp`;
        throw new Error('missing');
      }
      adds.push(command);
      return '';
    };
    const options = {
      projectRoot: f.project,
      home: f.home,
      yes: true,
      print: (line: string) => output.push(line),
      run,
    };
    await init(options);
    assert.deepEqual(adds, []);
    const said = output.join('\n');
    assert.match(
      said,
      /claude: Proofmarks comes from its plugin, and an earlier init registered it too, so the agent sees every tool twice\. Remove that one with: claude mcp remove proofmarks/,
    );
    assert.match(said, /codex: Proofmarks comes from its plugin, so there's nothing to register\./);
    // A plugin that's turned off doesn't count.
    await codexConfig(false);
    await init(options);
    assert.deepEqual(adds, ['codex']);
  } finally {
    await f.close();
  }
});
