import { updateAgentSettings } from './agents';
import type { ProofmarksAgents, ProofmarksCompanionStatus, ProofmarksRule, ProofmarksStrictness } from './types';

/** Which rules show on the page. A page with no proofs yet isn't ready until its first review; rule switches last for this page view. */
export function settingsState(options: { empty: boolean }) {
  const hidden = new Set<string>();
  let ready = !options.empty;
  return {
    get ready() {
      return ready;
    },
    visible: (rule: string) => ready && !hidden.has(rule),
    toggleRule(rule: string) {
      if (hidden.has(rule)) hidden.delete(rule);
      else hidden.add(rule);
      return !hidden.has(rule);
    },
    finish() {
      ready = true;
    },
  };
}

export function companionStatusText(status?: ProofmarksCompanionStatus) {
  return status?.connected
    ? `${status.provider ?? 'Judge'} · connected · ${status.model ?? ''}`
    : (status?.reason ?? 'Jev · not connected');
}

const marks = (count: number) => `${count} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'mark' : 'marks'}`;
/** How this site has called a rule's marks, and whether that moved its line. */
export function strictnessText(entry: ProofmarksStrictness) {
  const total = entry.kept + entry.dismissed;
  if (entry.line > entry.base) return `Stricter here: you dismissed ${entry.dismissed} of ${total}.`;
  if (entry.line < entry.base) return `Looser here: you kept ${entry.kept} of ${total}.`;
  if (!entry.kept) return `You dismissed ${marks(entry.dismissed)} so far.`;
  if (!entry.dismissed) return `You kept ${marks(entry.kept)} so far.`;
  return `You kept ${entry.kept} and dismissed ${entry.dismissed} so far.`;
}

function switchRow(doc: Document, name: string, on: boolean, flip: () => boolean) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.onclick = () => b.setAttribute('aria-checked', String(flip()));
  b.className = 'd-switch-row';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  const track = doc.createElement('span');
  track.className = 'd-switch';
  track.setAttribute('aria-hidden', 'true');
  b.append(track);
  return b;
}
function sectionIn(doc: Document, body: HTMLElement, title: string) {
  const s = doc.createElement('section'),
    h = doc.createElement('h3');
  h.textContent = title;
  s.append(h);
  body.append(s);
  return s;
}

/** The settings view in the review surface: the judge's status, a row per rule that opens its page, and which agent rewrites. */
export function settingsContent(o: {
  doc: Document;
  rules: ProofmarksRule[];
  agents?: ProofmarksAgents;
  agentReason?: string;
  targetBusy?: boolean;
  selectTarget?: (target: string) => void;
  status?: ProofmarksCompanionStatus;
  openRule: (rule: string) => void;
}) {
  const { doc } = o,
    body = doc.createElement('div');
  body.className = 'd-settings';
  const judge = sectionIn(doc, body, 'Judge'),
    status = doc.createElement('p');
  status.dataset.companionStatus = '';
  status.textContent = companionStatusText(o.status);
  judge.append(status);
  const rules = sectionIn(doc, body, 'Rules');
  for (const r of o.rules) {
    const open = doc.createElement('button'),
      name = doc.createElement('span'),
      chevron = doc.createElement('span');
    open.type = 'button';
    open.className = 'd-rule-open';
    open.dataset.rule = r.id;
    open.onclick = () => o.openRule(r.id);
    name.textContent = r.label;
    chevron.textContent = '›';
    chevron.setAttribute('aria-hidden', 'true');
    open.append(name, chevron);
    rules.append(open);
  }
  const rewrites = sectionIn(doc, body, 'Rewrite with');
  updateAgentSettings(rewrites, {
    agents: o.agents,
    reason: o.agentReason,
    busy: o.targetBusy,
    select: target => o.selectTarget?.(target),
  });
  return body;
}

/** One rule's page: its switch for this page view, what it checks, how this site has called its marks, and Reset when its line has moved. */
export function ruleContent(o: {
  doc: Document;
  rule: ProofmarksRule;
  state: ReturnType<typeof settingsState>;
  changed: () => void;
  strictness?: ProofmarksStrictness;
  resetStrictness?: (rule: string) => void;
  resetting?: boolean;
}) {
  const { doc, rule } = o,
    body = doc.createElement('div');
  body.className = 'd-settings d-rule-page';
  body.append(
    switchRow(doc, 'Show these marks', o.state.visible(rule.id), () => {
      const on = o.state.toggleRule(rule.id);
      o.changed();
      return on;
    }),
  );
  const rubric = rule.rubric;
  for (const [title, text] of [
    ['Checks', rubric?.checks ?? rule.why],
    ['Looks like', rubric?.looksLike],
    ['Not this', rubric?.notLike],
    ['Try', rubric?.fix ?? rule.fix],
  ] as const) {
    if (!text) continue;
    const p = doc.createElement('p');
    p.textContent = text;
    sectionIn(doc, body, title).append(p);
  }
  const entry = o.strictness;
  if (entry) {
    const site = sectionIn(doc, body, 'On this site'),
      row = doc.createElement('div'),
      copy = doc.createElement('p');
    row.className = 'd-learned';
    copy.textContent = strictnessText(entry);
    row.append(copy);
    if (entry.line !== entry.base) {
      const reset = doc.createElement('button');
      reset.type = 'button';
      reset.className = 'd-learned-reset';
      reset.textContent = 'Reset';
      reset.setAttribute('aria-label', `Reset strictness for ${rule.label}`);
      reset.disabled = !!o.resetting || !o.resetStrictness;
      reset.onclick = () => o.resetStrictness?.(rule.id);
      row.append(reset);
    }
    site.append(row);
  }
  return body;
}
