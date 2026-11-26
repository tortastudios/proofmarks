import { rewriteVersions, type RewriteVersion } from '../versions';
import type { ProofmarksFinding } from './types';

/** Try another, as an icon: a circular arrow with the same slight brush lean as the Proofmarks mark. */
export function refreshIcon(doc: Document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M19.2 12.6C18.9 16.6 15.6 19.8 11.7 19.8C7.6 19.8 4.3 16.4 4.4 12.2C4.5 8.1 7.9 4.8 12 4.9C14.6 5 16.8 6.3 18.1 8.3',
    'M18.7 3.9L18.3 8.6L13.8 8.1',
  ]) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Version arrows as icons, drawn on the same centre line as the refresh icon (text arrows sit low on the font's x-height). */
export function chevronIcon(doc: Document, direction: 'previous' | 'next') {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', direction === 'previous' ? 'M14.25 7L9.75 12L14.25 17' : 'M9.75 7L14.25 12L9.75 17');
  svg.append(path);
  return svg;
}

export type VersionSlot = { version: number; rewrite?: RewriteVersion };
/** Every version that arrived, plus the one being written (or that failed) when it is still owed. */
export function versionSlots(finding: ProofmarksFinding, live: boolean): VersionSlot[] {
  const versions = rewriteVersions(finding),
    slots: VersionSlot[] = versions.map(rewrite => ({ version: rewrite.version, rewrite }));
  if (live && versions.length)
    slots.push({ version: Math.max(finding.rewriteRequest?.version ?? 0, versions.at(-1)!.version + 1) });
  return slots;
}
/** The reader's choice survives arrivals. Without one, show the finding's current rewrite (the newest, or the one restored by Undo). */
export function selectedSlot(slots: VersionSlot[], selected?: number, current?: string) {
  return (
    slots.find(slot => slot.version === selected) ??
    slots.find(slot => slot.rewrite && slot.rewrite.text === current) ??
    slots.filter(slot => slot.rewrite).at(-1) ??
    slots.at(-1)
  );
}

/** Queue stepping: the nearest proof in reading order that has a rewrite to decide, from wherever the reader is. */
export function stepQueue(
  ordered: ProofmarksFinding[],
  ready: ReadonlySet<string>,
  id: string | undefined,
  direction: number,
) {
  const start = ordered.findIndex(f => f.id === id),
    length = ordered.length;
  for (let n = 1; n <= length; n++) {
    const f = ordered[((start < 0 ? (direction > 0 ? -1 : 0) : start) + direction * n + length * (n + 1)) % length]!;
    if (ready.has(f.id)) return f;
  }
  return undefined;
}

/** Accept all takes an open proof whose rewrite on screen cleared the judge, unless its source can't take the edit. */
export const acceptsAll = (finding: ProofmarksFinding, text: string | undefined, slot?: VersionSlot) =>
  (finding.status ?? 'open') === 'open' && !finding.actionReason && text !== undefined && !slot?.rewrite?.stillFlagged;

/** Overview's line over Accept all: what's ready and what's left to check, then the run's progress. */
export function acceptAllStatus(ready: number, unclear: number, accepting?: { done: number; total: number }) {
  if (accepting) return `Accepting ${Math.min(accepting.done + 1, accepting.total)} of ${accepting.total}…`;
  return (
    `${ready} ${ready === 1 ? 'rewrite' : 'rewrites'} ready` + (unclear ? `, and ${unclear} to check yourself.` : '.')
  );
}

/** Open proofs with a rewrite to decide, and open proofs still waiting on one, in the order given. */
export function rewriteQueue(findings: ProofmarksFinding[]) {
  const open = findings.filter(f => (f.status ?? 'open') === 'open');
  return {
    ready: open.filter(f => rewriteVersions(f).length > 0),
    writing: open.filter(f => ['pending', 'claimed'].includes(f.rewriteRequest?.status ?? '')),
    missing: open.filter(
      f => f.proposed === undefined && !['pending', 'claimed'].includes(f.rewriteRequest?.status ?? ''),
    ),
  };
}
