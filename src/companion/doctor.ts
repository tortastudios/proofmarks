import { agentStatus } from '../agents/index';
import { findConfig } from './config';
import { devPage } from './dev-page';
import { judgeStatus } from './keys';

/**
 * proofmarks doctor: checks every link between a site and Proofmarks, so a person, or the agent setting it up
 * for them, knows what works and what to do next. A warning still works; a failure needs fixing.
 */
export type Check = { id: string; status: 'ok' | 'warn' | 'fail'; detail: string; next?: string };
type Deps = {
  fetch?: typeof fetch;
  judge?: () => Promise<{ route: string; connected: boolean }>;
  agents?: (projectRoot: string) => ReturnType<typeof agentStatus>;
};

const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const answers = async (request: typeof fetch, url: string) => {
  try {
    const response = await request(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    return { ok: response.status < 500, status: response.status, text: () => response.text() };
  } catch {
    return undefined;
  }
};

export async function doctor(start: string, deps: Deps = {}): Promise<Check[]> {
  const request = deps.fetch ?? fetch,
    checks: Check[] = [];
  const config = await findConfig(start).catch((error: Error) => {
    checks.push({ id: 'project', status: 'fail', detail: error.message, next: 'Fix proofmarks.config.json.' });
    return null;
  });
  if (config === undefined)
    checks.push({
      id: 'project',
      status: 'fail',
      detail: 'No proofmarks.config.json here or above.',
      next: 'Run proofmarks init --yes in the site folder.',
    });
  else if (config)
    checks.push({
      id: 'project',
      status: config.documents.length ? 'ok' : 'warn',
      detail: `${config.documents.length} ${config.documents.length === 1 ? 'document' : 'documents'} in ${config.projectRoot}/proofmarks.config.json`,
      ...(config.documents.length
        ? {}
        : { next: 'Run proofmarks init --content <folder> with the folder your writing is in.' }),
    });

  const judge = await (deps.judge ?? judgeStatus)().catch(() => ({ route: 'unknown', connected: false }));
  checks.push({
    id: 'judge',
    status: judge.connected ? 'ok' : 'fail',
    detail: `Jev through ${judge.route}, ${judge.connected ? 'answering' : 'not answering'}`,
    ...(judge.connected
      ? {}
      : {
          next:
            judge.route === 'your key'
              ? 'Check TYPESAFE_API_KEY and your connection.'
              : "Check your internet connection. If Torta's relay is down, set TYPESAFE_API_KEY to your own Jev key.",
        }),
  });
  if (!config) return checks;

  const site = config.devServer;
  const siteAnswer = site ? await answers(request, site) : undefined;
  checks.push(
    !site
      ? {
          id: 'site',
          status: 'warn',
          detail: 'No site address in proofmarks.config.json.',
          next: 'Add "devServer" with your site\'s local address, or pass --to to proofmarks dev.',
        }
      : siteAnswer?.ok
        ? { id: 'site', status: 'ok', detail: `Answers at ${site}` }
        : {
            id: 'site',
            status: 'fail',
            detail: `Nothing answers at ${site}.`,
            next: "Start your site's development server.",
          },
  );

  const base = await devPage(config.projectRoot);
  const document = config.documents.find(entry => entry.url && !entry.url.includes('*'));
  if (!base)
    checks.push({
      id: 'page',
      status: 'fail',
      detail: "proofmarks dev isn't running.",
      next: 'Run proofmarks dev --background in the site folder: it starts the site too if needed, and keeps both running.',
    });
  else {
    const url = new URL(document?.url ?? '/', base);
    url.searchParams.set('proof', '1');
    const page = await answers(request, url.href);
    const marked = page?.ok && (await page.text().catch(() => '')).includes('/__proofmarks/script.js');
    checks.push(
      marked
        ? { id: 'page', status: 'ok', detail: `Open ${url.href} to see the proofs.` }
        : page?.ok
          ? {
              id: 'page',
              status: 'warn',
              detail: `${url.href} answers, but without Proofmarks on it.`,
              next: 'Open a page that shows your writing, with ?proof=1 at the end.',
            }
          : {
              id: 'page',
              status: 'fail',
              detail: `proofmarks dev doesn't answer at ${base}.`,
              next: 'Restart proofmarks dev.',
            },
    );
  }

  const agents = await (deps.agents ?? agentStatus)(config.projectRoot);
  const headless = agents.headless.filter(entry => entry.available).map(entry => entry.label);
  checks.push(
    headless.length || agents.agents.length
      ? {
          id: 'rewrites',
          status: 'ok',
          detail: `${list([...new Set([...agents.agents.map(agent => agent.label), ...headless])])} can write them`,
        }
      : {
          id: 'rewrites',
          status: 'warn',
          detail: 'No agent to write rewrites. The proofs still show; you edit by hand.',
          next: 'Install Claude Code, Codex or pi, or connect an MCP agent.',
        },
  );
  checks.push(
    agents.agents.length
      ? {
          id: 'agents',
          status: 'ok',
          detail: `Connected: ${agents.agents.map(agent => `${agent.label} (${agent.delivery})`).join(', ')}`,
        }
      : {
          id: 'agents',
          status: 'warn',
          detail: 'No agent session is connected to Proofmarks yet.',
          next: 'Restart your agent, or run /mcp in Claude Code, to proof pages with it ("proof this page").',
        },
  );
  return checks;
}

export function doctorReport(checks: Check[]) {
  const mark = { ok: '✓', warn: '–', fail: '✗' } as const;
  const names: Record<string, string> = {
    project: 'Project',
    judge: 'Judge',
    site: 'Your site',
    page: 'Page',
    rewrites: 'Rewrites',
    agents: 'Agents',
  };
  return checks
    .map(
      check =>
        `${mark[check.status]} ${names[check.id] ?? check.id}: ${check.detail}${check.next ? `\n    Next: ${check.next}` : ''}`,
    )
    .join('\n');
}
