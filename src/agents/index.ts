import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { alive } from '../companion/alive';
import { atomicJson, ReviewError } from '../companion/state';
import { findCommand } from './command';
export type Agent = {
  id: string;
  host: 'claude-code' | 'codex' | 'pi' | 'other';
  hostVersion: string;
  project: string;
  pid: number;
  startedAt: string;
  lastSeenAt: string;
  delivery: 'push' | 'watch' | 'manual';
};
export const labels = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'pi', other: 'MCP agent' };
export const clis = ['claude', 'codex', 'pi'] as const;
export type Cli = (typeof clis)[number];
export async function stateDirectory(project: string, child = '') {
  const root = await realpath(project),
    base = path.join(root, '.proofmarks');
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await realpath(base)) !== base) throw new ReviewError('Proofmarks state directory must not be a symlink');
  const dir = path.join(base, child);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await realpath(dir)) !== dir) throw new ReviewError('Proofmarks state directory must not be a symlink');
  return dir;
}
export async function installed(cli: Cli) {
  return (await findCommand(cli)) !== undefined;
}
export async function liveAgents(project: string, now = Date.now()) {
  const dir = await stateDirectory(project, 'agents'),
    agents: Agent[] = [];
  for (const name of await readdir(dir)) {
    if (!/^[a-zA-Z0-9-]+\.json$/.test(name)) continue;
    try {
      const file = path.join(dir, name);
      if ((await realpath(file)) !== file) continue;
      const agent = JSON.parse(await readFile(file, 'utf8')) as Agent;
      if (
        agent.id + '.json' !== name ||
        agent.project !== (await realpath(project)) ||
        !Object.hasOwn(labels, agent.host) ||
        !['push', 'watch', 'manual'].includes(agent.delivery) ||
        !Number.isInteger(agent.pid) ||
        agent.pid < 1 ||
        !Number.isFinite(Date.parse(agent.startedAt)) ||
        !Number.isFinite(Date.parse(agent.lastSeenAt)) ||
        now - Date.parse(agent.lastSeenAt) > 30000 ||
        Date.parse(agent.lastSeenAt) > now + 10000 ||
        !alive(agent.pid)
      )
        continue;
      agents.push(agent);
    } catch {
      /* Invalid, dead and stale records are never listed. */
    }
  }
  return agents.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id));
}
export async function agentStatus(project: string) {
  const agents = await liveAgents(project);
  const headless = await Promise.all(
    clis.map(async cli => ({
      id: `headless:${cli}`,
      label: labels[cli === 'claude' ? 'claude-code' : cli],
      available: await installed(cli),
    })),
  );
  let target: string | null = null;
  try {
    const file = path.join(await stateDirectory(project), 'target.json');
    if ((await realpath(file)) === file) {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (typeof saved.target === 'string') target = saved.target;
    }
  } catch {}
  const valid = (id: string | null) =>
    !!id && (agents.some(a => a.id === id) || headless.some(h => h.id === id && h.available));
  return {
    agents: agents.map(a => ({
      id: a.id,
      host: a.host,
      label: labels[a.host],
      project: a.project,
      startedAt: a.startedAt,
      delivery: a.delivery,
    })),
    headless,
    target,
    resolvedTarget: valid(target) ? target : (agents[0]?.id ?? headless.find(h => h.available)?.id ?? null),
  };
}
export async function selectTarget(project: string, target: string) {
  const status = await agentStatus(project);
  if (!status.agents.some(a => a.id === target) && !status.headless.some(a => a.id === target && a.available))
    throw new ReviewError('Choose a connected agent or an installed CLI');
  await atomicJson(path.join(await stateDirectory(project), 'target.json'), { target });
  return agentStatus(project);
}
/** id: chosen by a host that delivers this agent's requests itself (the pi extension); otherwise a fresh one. */
export async function registerAgent(
  project: string,
  client: { name: string; version: string },
  delivery: Agent['delivery'] = 'manual',
  id?: string,
) {
  if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new ReviewError('Agent id must be a UUID');
  const name = client.name.toLowerCase();
  const host: Agent['host'] = name.includes('claude')
    ? 'claude-code'
    : name.includes('codex')
      ? 'codex'
      : /\bpi\b/.test(name)
        ? 'pi'
        : 'other';
  const agent: Agent = {
    id: id ?? randomUUID(),
    host,
    hostVersion: client.version,
    project: await realpath(project),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    delivery,
  };
  const file = path.join(await stateDirectory(project, 'agents'), agent.id + '.json');
  let active = true;
  let writing: Promise<void> = Promise.resolve();
  const heartbeat = async () => {
    if (!active) return;
    writing = writing
      .catch(() => {})
      .then(async () => {
        if (!active) return;
        agent.lastSeenAt = new Date().toISOString();
        await atomicJson(file, agent);
      });
    await writing;
  };
  await heartbeat();
  const timer = setInterval(() => void heartbeat().catch(() => {}), 10000);
  timer.unref();
  return {
    agent,
    async delivery(value: Agent['delivery']) {
      agent.delivery = value;
      await heartbeat();
    },
    async close() {
      active = false;
      clearInterval(timer);
      await writing.catch(() => {});
      await unlink(file).catch(() => {});
    },
  };
}
