export type Shortcut =
  | 'toggle-card'
  | 'toggle-marks'
  | 'next-open'
  | 'previous-open'
  | 'next'
  | 'previous'
  | 'accept'
  | 'dismiss'
  | 'undo'
  | 'help'
  | 'escape'
  | 'dock'
  | 'overview'
  | 'why'
  | 'settings'
  | 'previous-version'
  | 'next-version';
type Key = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing' | 'repeat'>;
export function proofShortcut(
  e: Key,
  context: { editable: boolean; card: boolean; pill: boolean; help: boolean; badgeExpanded: boolean },
): Shortcut | undefined {
  if (context.editable || e.isComposing || e.metaKey || e.ctrlKey) return;
  if (e.altKey) return !e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.key) ? 'dock' : undefined;
  const k = e.key.toLowerCase();
  if (e.repeat && !['ArrowLeft', 'ArrowRight', 'n', 'N'].includes(e.key)) return;
  if (e.key === '?') return 'help';
  if (e.shiftKey) return k === 'p' ? 'toggle-marks' : k === 'n' ? 'previous-open' : undefined;
  if (k === 'p') return 'toggle-card';
  if (k === 'n') return 'next-open';
  if (k === 'o') return 'overview';
  if (k === 'i') return 'why';
  if (k === ',') return 'settings';
  if (e.key === 'Escape') return context.card || context.help || context.badgeExpanded ? 'escape' : undefined;
  if (!context.card) return;
  if (e.key === 'ArrowLeft') return 'previous';
  if (e.key === 'ArrowRight') return 'next';
  if (k === 'a') return 'accept';
  if (k === 'd') return 'dismiss';
  if (k === 'u') return 'undo';
  if (e.key === '[') return 'previous-version';
  if (e.key === ']') return 'next-version';
  return undefined;
}
