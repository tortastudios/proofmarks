import type { ProofmarksAgents, ProofmarksFinding } from './types';
import { rewriteVersions } from '../versions';
const hosts: Record<string, string> = {
  claude: 'Claude Code',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  pi: 'pi',
  other: 'Your agent',
};
type Host = ProofmarksAgents['agents'][number]['host'];
const headlessHosts: Record<string, Host> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  pi: 'pi',
};
/**
 * Each agent writes its working line in its own color: Claude's orange, a Codex blue, and the salmon of pi's
 * logo. Every other agent keeps the rule's ink. All three clear 4.5:1 on the card's ink.
 */
export const agentColors: Partial<Record<Host, string>> = { 'claude-code': '#d97757', codex: '#7aa2f7', pi: '#f09082' };
export function agentHost(target: string | undefined, agents?: ProofmarksAgents) {
  return (
    agents?.agents.find(agent => agent.id === target)?.host ??
    (target?.startsWith('headless:') ? headlessHosts[target.slice(9)] : undefined)
  );
}
export const resolvedTarget = (agents?: ProofmarksAgents) => agents?.resolvedTarget ?? agents?.target ?? undefined;
export function agentLabel(target: string | undefined, agents?: ProofmarksAgents) {
  return (
    agents?.agents.find(agent => agent.id === target)?.label ??
    agents?.headless.find(agent => agent.id === target)?.label.replace(/,?\s*(?:no|without a) conversation$/i, '') ??
    (target?.startsWith('headless:') ? hosts[target.slice(9)] : 'Your agent') ??
    'Your agent'
  );
}
export function rewriteState(finding: ProofmarksFinding, agents?: ProofmarksAgents, now = Date.now(), error?: string) {
  const request = finding.rewriteRequest,
    target = request ? (request.target ?? request.claimedBy) : resolvedTarget(agents),
    label = agentLabel(target, agents);
  // A request for another version is live while its version hasn't arrived; a cancelled one leaves the earlier versions.
  const versions = rewriteVersions(finding).length,
    another = !!request && (request.version ?? 1) > versions && versions > 0;
  const open =
    (finding.status ?? 'open') === 'open' &&
    (finding.proposed === undefined ||
      !!error ||
      (another && !(request?.status === 'failed' && request.error === 'Cancelled')));
  const waiting = open && (request?.status === 'pending' || request?.status === 'claimed');
  const started = Date.parse(request?.requestedAt ?? '');
  const delivery = agents?.agents.find(agent => agent.id === target)?.delivery;
  const stalled =
    waiting &&
    request?.status === 'pending' &&
    (delivery === 'push' || delivery === 'watch' || (!delivery && !!target && !target.startsWith('headless:'))) &&
    Number.isFinite(started) &&
    now - started >= 30_000;
  const failed = open && (request?.status === 'failed' || !!error);
  const message = !open
    ? ''
    : (error ??
      (failed
        ? (request?.error ?? 'The rewrite failed. Try again.')
        : stalled
          ? `${label} hasn't picked this up. Is it watching?`
          : request?.status === 'claimed'
            ? `${label} is writing`
            : waiting
              ? `Sent to ${label === 'Your agent' ? 'your agent' : label}`
              : ''));
  const working =
    waiting && !stalled && !failed
      ? request?.status === 'claimed'
        ? ('writing' as const)
        : ('sent' as const)
      : undefined;
  const host = agentHost(target, agents),
    color = host && agentColors[host];
  return { waiting, stalled, failed, message, retry: stalled || failed, label, working, color };
}
export function agentChoices(agents: ProofmarksAgents) {
  return [
    ...agents.agents.map(agent => {
      const date = new Date(agent.startedAt),
        time = Number.isNaN(date.getTime())
          ? ''
          : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const project = agent.project.split(/[\\/]/).filter(Boolean).at(-1);
      return {
        id: agent.id,
        label: [agent.label, project, time ? `started ${time}` : ''].filter(Boolean).join(' · '),
        delivery:
          agent.delivery === 'push'
            ? 'Pushes to the conversation'
            : agent.delivery === 'watch'
              ? 'Waiting in watch mode'
              : 'Not watching yet. Ask this agent to watch.',
      };
    }),
    ...agents.headless
      .filter(agent => agent.available)
      .map(agent => ({
        id: agent.id,
        label: `${agentLabel(agent.id, agents)}, no conversation`,
        delivery: 'Runs without a conversation',
      })),
  ];
}
export function updateAgentSettings(
  section: HTMLElement,
  o: { agents?: ProofmarksAgents; reason?: string; busy?: boolean; select: (target: string) => void },
) {
  const doc = section.ownerDocument,
    root = section.getRootNode(),
    focused = root instanceof ShadowRoot ? root.activeElement : doc.activeElement;
  const focusId = focused instanceof HTMLElement ? focused.dataset.agentTarget : undefined;
  section.replaceChildren();
  section.dataset.rewriteTargets = '';
  const heading = doc.createElement('h3');
  heading.textContent = 'Rewrite with';
  section.append(heading);
  const note = (text: string) => {
    const p = doc.createElement('p');
    p.textContent = text;
    p.setAttribute('role', 'status');
    section.append(p);
  };
  if (!o.agents) {
    note(o.reason ?? 'Checking for connected agents…');
    return;
  }
  const choices = agentChoices(o.agents),
    target = resolvedTarget(o.agents);
  if (!choices.length) {
    note('Connect an MCP agent in watch mode, or install Claude Code, Codex or pi.');
    return;
  }
  if (!o.agents.agents.length && choices.length === 1) {
    note(`No agents connected. Ask uses ${agentLabel(choices[0]!.id, o.agents)} without a conversation.`);
    if (o.reason) note(o.reason);
    return;
  }
  const group = doc.createElement('div');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Rewrite with');
  for (const choice of choices) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'd-switch-row d-agent-row';
    button.dataset.agentTarget = choice.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(choice.id === target));
    button.tabIndex = choice.id === (target ?? choices[0]?.id) ? 0 : -1;
    button.disabled = !!o.busy;
    const copy = doc.createElement('span');
    copy.className = 'd-agent-copy';
    const label = doc.createElement('span');
    label.textContent = choice.label;
    copy.append(label);
    if (choice.id === target) {
      const how = doc.createElement('span');
      how.className = 'd-agent-delivery';
      how.textContent = choice.delivery;
      copy.append(how);
    }
    const check = doc.createElement('span');
    check.setAttribute('aria-hidden', 'true');
    check.textContent = choice.id === target ? '✓' : '';
    button.append(copy, check);
    button.onclick = () => o.select(choice.id);
    group.append(button);
  }
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!buttons.length) return;
    const current = buttons.indexOf(event.target as HTMLButtonElement),
      index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index]!.focus();
    buttons[index]!.click();
  });
  section.append(group);
  if (o.reason) note(o.reason);
  if (focusId)
    section.querySelectorAll<HTMLButtonElement>('[data-agent-target]').forEach(button => {
      if (button.dataset.agentTarget === focusId && !button.disabled) button.focus({ preventScroll: true });
    });
}
