import type { ProofmarksFinding, ProofmarksRule } from './types';
export const percent = (score: number) => `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
export const signalThreshold = (signal: { threshold?: number }) => signal.threshold ?? 0.6;
/** Inline Why content; navigation belongs to the single review surface. */
export function whyContent(doc: Document, f: ProofmarksFinding, rule?: ProofmarksRule) {
  const body = doc.createElement('div');
  body.className = 'why-content';
  const title = doc.createElement('h3');
  title.className = 'record-title';
  title.textContent = rule?.label ?? f.rule;
  body.append(title);
  if (f.actionReason) {
    const h = doc.createElement('h4'),
      p = doc.createElement('p');
    h.textContent = 'Edit details';
    p.className = 'record-action-reason';
    p.textContent = f.actionReason;
    body.append(h, p);
  }
  const rubric = rule?.rubric;
  if (rubric) {
    for (const [label, text] of [
      ['Checks', rubric.checks],
      ['Looks like', rubric.looksLike],
      ['Not this', rubric.notLike],
      ['Try', rubric.fix],
    ] as const) {
      const h = doc.createElement('h4'),
        p = doc.createElement('p');
      h.textContent = label;
      p.textContent = text;
      body.append(h, p);
    }
  }
  if (!f.judge) {
    const meta = doc.createElement('p');
    meta.className = 'record-meta';
    meta.textContent = f.id;
    body.append(meta);
    return body;
  }
  const scores = doc.createElement('section');
  scores.className = 'record-scores';
  const caption = doc.createElement('h4');
  caption.textContent = 'Sentence signals';
  scores.append(caption);
  const signals = [
    {
      id: 'rule',
      label: rule?.label ?? f.rule,
      score: f.judge.probability ?? f.judge.score ?? 0,
      threshold: f.judge.threshold,
    },
    ...(f.judge.signals ?? []),
  ];
  for (const signal of signals) {
    const row = doc.createElement('div');
    row.className = 'signal-row';
    const label = doc.createElement('span');
    label.textContent = signal.label;
    const value = doc.createElement('span');
    value.className = 'signal-value';
    value.textContent = percent(signal.score);
    const track = doc.createElement('span');
    track.className = 'signal-track';
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', signal.label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(signal.score * 100)));
    track.setAttribute('aria-valuetext', `${percent(signal.score)}; threshold ${percent(signalThreshold(signal))}`);
    const fill = doc.createElement('span');
    fill.className = 'signal-fill';
    fill.style.width = percent(signal.score);
    const tick = doc.createElement('span');
    tick.className = 'signal-tick';
    tick.style.left = percent(signalThreshold(signal));
    track.append(fill, tick);
    row.append(label, value, track);
    scores.append(row);
  }
  if (f.judge.after !== undefined) {
    const after = typeof f.judge.after === 'number' ? f.judge.after : f.judge.after.probability;
    const p = doc.createElement('p');
    p.textContent = `Rewrite: ${percent(after)}; threshold ${percent(f.judge.threshold)}`;
    scores.append(p);
  }
  body.append(scores);
  const meta = doc.createElement('p');
  meta.className = 'record-meta';
  meta.textContent = `${f.id} · ${f.judge.model} · ${f.judge.scope ?? f.level ?? 'sentence'}`;
  body.append(meta);
  return body;
}
