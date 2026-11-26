#!/usr/bin/env -S node --import tsx
import { acquireHelper, checkRunningHelper, runHelper, helperStatus, passOffToRunningDev } from './lifecycle';
import { devProxy } from '../proxy/index';
import { ownKey, judgeStatus } from './keys';
import { createJev, sanitizedError } from '../judge/jev';
import { createRelayJev, rememberVia, validVia, RESTING } from '../judge/relay';
import { telemetryCommand } from './telemetry';
import { checkFormat, checkTarget, expandTargets, githubReport, textReport, type Checked } from './check';
import { version, installRoute } from './version';
import {
  answers,
  clearDevPage,
  devPage,
  openInBrowser,
  recordDevPage,
  startSite,
  stopDevPage,
  stopSite,
  runningDev,
} from './dev-page';
import { standalone } from './standalone';
import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { doctor, doctorReport } from './doctor';
import { fakeProvider } from './fake';
import { reviewFile } from './review';
import { serve } from './server';
import { mcp } from './mcp';
import { detectStack, init } from './init';
import { findConfig } from './config';
import { ConfigError } from '../config/index';
import { fileProblem, UserError } from './user-error';
import { ReviewError, ReviewStore } from './state';
import { storeStrictness } from './strictness';
import { decisionCount, sendDecisionCount } from './decision-counts';
import path from 'node:path';
const usage =
  'Usage: proofmarks init [--content <folder>] [--via <listing>] [--yes] | status | telemetry [status|on|off] | doctor [--json] | check <files, folders or URLs> [--format text|json|github] [--fail-on <n>] | review <file> [--out file] [--json] | serve [--root <documents>] [--judge fake] [--port 4848] | dev [--to URL] [--port 4849] [--open] [--background | --stop] | mcp [--root <documents>] [--judge fake] [--project <project>] | --version';
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
function reviewSummary(
  file: string,
  marks: number,
  judge: string,
  usage: { calls: number; dollars: number; cached: number },
) {
  const count = `${marks} ${marks === 1 ? 'mark' : 'marks'}`;
  if (judge === 'fake') return `Reviewed ${file}: ${count} (fake judge: test data, not real judgments)`;
  const calls = `${usage.calls} ${usage.calls === 1 ? 'call' : 'calls'}${usage.cached ? `, ${usage.cached} cached` : ''}`;
  return `Reviewed ${file}: ${count} (Jev: ${calls}, $${usage.dollars.toFixed(2)})`;
}
async function main() {
  const command = args[0];
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(version);
    return;
  }
  // --help anywhere, as in `proofmarks review --help`, which otherwise read as a file named --help.
  if (
    command === '--help' ||
    command === '-h' ||
    command === 'help' ||
    args.includes('--help') ||
    args.includes('-h')
  ) {
    console.log(usage);
    return;
  }
  if (command === 'init') {
    // Listings add --via <name>, so the install count can say where people found Proofmarks, when the person
    // turns usage counts on.
    const via = option('--via');
    if (via !== undefined && !validVia(via))
      throw new UserError("--via takes a listing's short name, such as mcp-registry.");
    await init({
      projectRoot: option('--project') ?? process.cwd(),
      content: args.flatMap((arg, i) => (arg === '--content' && args[i + 1] ? [args[i + 1]!] : [])),
      yes: args.includes('--yes') || args.includes('-y'),
    });
    if (via) await rememberVia(via);
    return;
  }
  if (command === 'telemetry') {
    console.log(await telemetryCommand(args[1]));
    return;
  }
  // login and logout are left from builds that stored a Jev key; the relay needs none.
  if (command === 'login' || command === 'logout')
    throw new UserError(
      "Proofmarks doesn't need a Jev key: it uses Jev through Torta's relay. To use your own key instead, set TYPESAFE_API_KEY.",
    );
  if (!['status', 'doctor', 'check', 'review', 'serve', 'mcp', 'dev', '_helper'].includes(command ?? ''))
    throw new UserError(usage);
  if (command === 'doctor') {
    const checks = await doctor(option('--project') ?? process.cwd());
    console.log(args.includes('--json') ? JSON.stringify({ checks }) : doctorReport(checks));
    if (checks.some(check => check.status === 'fail')) process.exitCode = 1;
    return;
  }
  if (command === 'status') {
    const project = await findConfig(option('--project') ?? process.cwd());
    console.log(JSON.stringify(await judgeStatus(project ? { helper: () => helperStatus(project.projectRoot) } : {})));
    return;
  }
  const config = await findConfig(option('--project') ?? option('--root') ?? process.cwd());
  const judge = option('--judge') ?? config?.judge.provider ?? 'jev';
  const key = judge === 'fake' ? undefined : ownKey();
  // Without a key of your own, Jev goes through Torta's relay, which gets this install's token on the first judgment.
  const install = { version, route: installRoute() };
  const provider = judge === 'fake' ? fakeProvider : key ? createJev(key) : createRelayJev(install);
  if (command === 'check') {
    const valued = new Set(['--format', '--fail-on', '--judge', '--cache-dir', '--project', '--root']);
    const inputs = args.slice(1).filter((arg, i, all) => !arg.startsWith('-') && !valued.has(all[i - 1] ?? ''));
    if (!inputs.length)
      throw new UserError(
        'Pass files, folders, globs or URLs to check, such as: proofmarks check content/ https://example.com/pricing',
      );
    const format = checkFormat(option('--format'), args.includes('--json'));
    if (!['text', 'json', 'github'].includes(format)) throw new UserError('--format takes text, json or github.');
    const failOn = option('--fail-on') === undefined ? undefined : Number(option('--fail-on'));
    if (failOn !== undefined && !(Number.isInteger(failOn) && failOn > 0))
      throw new UserError('--fail-on takes a whole number of marks, such as 1.');
    const targets = await expandTargets(inputs).catch((error: Error) => {
      throw new UserError(error.message);
    });
    if (!targets.length) throw new UserError('No Markdown, MDX, HTML or template files there.');
    if (judge !== 'fake' && !key && targets.length > 25)
      console.error(
        `Checking ${targets.length} pages through Torta's shared relay. Each install gets about 6,000 judge calls a day, roughly 50 to 100 pages; for bigger runs, set TYPESAFE_API_KEY to your own Jev key.`,
      );
    const site = config ? await ReviewStore.create(config.roots[0]!) : undefined;
    const results: Checked[] = [];
    for (const target of targets) {
      const result = await checkTarget(target, provider, {
        cacheDir: option('--cache-dir'),
        strictness: site && (bases => storeStrictness(site, bases)),
        rules: config?.rules,
      });
      results.push(result);
      // The shared judge's daily budget is used up: every page after this would fail the same way.
      if (result.error === RESTING) break;
    }
    const total = results.reduce((sum, result) => sum + result.marks.length, 0);
    if (format === 'json') console.log(JSON.stringify({ results, total }));
    else if (format === 'github') {
      const report = githubReport(results);
      if (report) console.log(report);
      console.error(
        `Proofmarks: ${total} ${total === 1 ? 'mark' : 'marks'} in ${results.length} ${results.length === 1 ? 'page' : 'pages'}`,
      );
    } else console.log(textReport(results));
    if (
      results.some(result => result.error) ||
      results.length < targets.length ||
      (failOn !== undefined && total >= failOn)
    )
      process.exitCode = 1;
    return;
  }
  if (command === 'review') {
    const file = args[1];
    if (!file) throw new UserError('Document path required');
    // One line for people; --json keeps the per-call estimates and the ledger for scripts.
    const json = args.includes('--json');
    const review = await reviewFile(file, provider, {
      out: option('--out'),
      root: option('--root') ?? config?.roots.find(root => path.resolve(file).startsWith(root + path.sep)),
      // A lone file with no project config: its review goes in a reviews folder beside it, not one level up.
      ...(!config && !option('--root') ? { reviewsDir: path.join(path.dirname(path.resolve(file)), 'reviews') } : {}),
      cacheDir: option('--cache-dir'),
      ...(json ? { onEstimate: (estimate: unknown) => console.log(JSON.stringify({ estimate })) } : {}),
    });
    if (json)
      console.log(
        JSON.stringify({
          reviewed: true,
          findings: review.findings.length,
          ledger: review.usage,
          mode: review.reviewMode,
        }),
      );
    else
      console.log(
        reviewSummary(
          file,
          review.findings.length,
          provider.id,
          review.usage as { calls: number; dollars: number; cached: number },
        ),
      );
  } else {
    if (command === 'dev' && !config) throw new UserError('Run proofmarks init before starting the dev proxy.');
    const root = option('--root') ?? config?.roots[0];
    if (!root) throw new UserError('--root <document directory> required');
    if (command === '_helper') {
      await runHelper({
        provider,
        roots: config?.roots ?? [root],
        projectRoot: config!.projectRoot,
        port: Number(option('--port') ?? 4848),
        strictPort: args.includes('--strict-port'),
        cacheDir: option('--cache-dir'),
        // Through the relay, each Accept, Dismiss and Undo is counted if the person turned usage counts on; with your own
        // key, nothing is sent.
        onDecision:
          judge !== 'fake' && !key
            ? (action, finding) => {
                const count = decisionCount(action, finding);
                if (count) void sendDecisionCount(count, install);
              }
            : undefined,
      });
      return;
    }
    // --agent is passed by the pi extension, which pushes that agent's requests into the session itself.
    if (command === 'mcp') {
      await mcp({ provider, root, cacheDir: option('--cache-dir'), pushAgent: option('--agent') });
      return;
    }
    if (config && command === 'dev' && args.includes('--stop')) {
      const proxy = await stopDevPage(config.projectRoot),
        site = await stopSite(config.projectRoot);
      console.log(
        proxy && site
          ? 'Stopped the Proofmarks dev proxy and the site it started.'
          : proxy
            ? 'Stopped the Proofmarks dev proxy.'
            : site
              ? 'Stopped the site the Proofmarks dev proxy started.'
              : "The Proofmarks dev proxy isn't running.",
      );
      return;
    }
    // An agent's commands end with its session, and so would a dev proxy it started: --background starts one on its
    // own, waits until it's serving, and returns.
    if (config && command === 'dev' && args.includes('--background')) {
      const running = await runningDev(config.projectRoot);
      if (running) {
        await checkRunningHelper(config.projectRoot, judge);
        await passOffToRunningDev(config.projectRoot, running.pid);
        console.log(`Proofmarks dev proxy: ${running.address} (already running; stop it with proofmarks dev --stop)`);
        return;
      }
      // The site goes first: a server the agent started would end with its session too.
      const to = option('--to') ?? config.devServer ?? 'http://localhost:3000';
      if (!(await answers(to))) {
        const { command: start } = await detectStack(config.projectRoot);
        console.log(`Starting the site with ${start}…`);
        if (!(await startSite(config.projectRoot, to, start)))
          throw new UserError(
            `The site didn't answer at ${to}. What it said is in .proofmarks/site.log; check devServer in proofmarks.config.json.`,
          );
      }
      await mkdir(path.join(config.projectRoot, '.proofmarks'), { recursive: true, mode: 0o700 });
      const log = await open(path.join(config.projectRoot, '.proofmarks', 'dev.log'), 'a', 0o600);
      let address: string | undefined;
      try {
        // The standalone program is its own CLI; the npm package runs this same bin.mjs.
        const child = spawn(
          process.execPath,
          [...(standalone ? [] : [process.argv[1]!]), ...args.filter(arg => arg !== '--background')],
          { cwd: process.cwd(), detached: true, stdio: ['ignore', log.fd, log.fd] },
        );
        child.unref();
        for (let attempt = 0; attempt < 300 && !address && child.exitCode === null; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          address = await devPage(config.projectRoot);
        }
      } finally {
        await log.close();
      }
      if (!address) throw new UserError("proofmarks dev didn't start. What it said is in .proofmarks/dev.log.");
      console.log(`Proofmarks dev proxy: ${address} (in the background; stop it with proofmarks dev --stop)`);
      return;
    }
    if (config) {
      // A --port the person passed is kept or refused; without one, a busy default moves aside.
      const devTo = option('--to') ?? config.devServer ?? 'http://localhost:3000';
      const chosen = option('--port') === undefined ? undefined : Number(option('--port'));
      const helper = await acquireHelper({
        projectRoot: config.projectRoot,
        judge,
        owner: command === 'dev' ? 'dev' : 'serve',
        cacheDir: option('--cache-dir'),
        ...(command === 'serve' ? { port: chosen } : {}),
      });
      const proxy =
        command === 'dev'
          ? await devProxy({
              projectRoot: config.projectRoot,
              to: devTo,
              helperPort: helper.port,
              port: chosen,
            }).catch(async (error: unknown) => {
              await helper.release();
              throw error;
            })
          : undefined;
      const port = proxy ? (proxy.address() as { port: number }).port : helper.port;
      console.log(`Proofmarks ${command === 'dev' ? 'dev proxy' : 'helper'}: http://127.0.0.1:${port}`);
      // Agents open the page for the person from this record (proofmarks_open_page).
      if (proxy) await recordDevPage(config.projectRoot, { port, pid: process.pid, to: devTo });
      if (command === 'dev' && args.includes('--open')) openInBrowser(`http://127.0.0.1:${port}`);
      const keepalive = setInterval(() => {}, 60000);
      const stop = () => {
        clearInterval(keepalive);
        proxy?.close();
        if (proxy) void clearDevPage(config.projectRoot);
        void helper.release();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      return;
    }
    const port = Number(option('--port') ?? 4848);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError('Invalid port');
    const server = await serve({
      provider,
      roots: [root],
      cacheDir: option('--cache-dir'),
      port,
      origin: option('--origin'),
    });
    console.log(`Proofmarks listening on 127.0.0.1:${port}`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
  }
}
// People see plain UserError, config and review messages as written; anything else could carry provider detail.
main().catch(error => {
  console.error(
    error instanceof UserError || error instanceof ConfigError || error instanceof ReviewError
      ? error.message
      : (fileProblem(error) ?? sanitizedError(error).message),
  );
  process.exitCode = 1;
});
