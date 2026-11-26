/**
 * Feedback from the agents that use Proofmarks: a problem report with an optional proposed fix, posted to
 * Torta's Slack, where someone can agree and ask Claude to open the PR. Only what the agent wrote, with the person's
 * okay, plus the Proofmarks version, install route and OS.
 */
export const KINDS = ['bug', 'wrong-mark', 'missed-habit', 'confusing-tool', 'feature', 'docs'] as const;
export type Feedback = {
  kind: (typeof KINDS)[number];
  summary: string;
  details: string;
  expected?: string;
  tool?: string;
  proposedFix?: string;
  version?: string;
  route?: string;
  os?: string;
};

const text = (value: unknown, max: number, required: boolean) =>
  typeof value === 'string'
    ? (value.trim().length > 0 && value.length <= max) || (!required && value === '')
    : !required && value === undefined;
const label = /^[A-Za-z0-9 ._+-]{1,40}$/;

export function validFeedback(body: unknown): body is Feedback {
  const value = body as Record<string, unknown> | null;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some(
      key => !['kind', 'summary', 'details', 'expected', 'tool', 'proposedFix', 'version', 'route', 'os'].includes(key),
    )
  )
    return false;
  if (!KINDS.some(kind => kind === value.kind)) return false;
  return (
    text(value.summary, 200, true) &&
    text(value.details, 4000, true) &&
    text(value.expected, 2000, false) &&
    text(value.proposedFix, 4000, false) &&
    (value.tool === undefined || (typeof value.tool === 'string' && /^[a-z_]{1,80}$/.test(value.tool))) &&
    ['version', 'route', 'os'].every(
      key => value[key] === undefined || (typeof value[key] === 'string' && label.test(value[key])),
    )
  );
}

// Slack's mrkdwn treats &, < and > as markup; escaping them keeps a report from pinging channels or forming links.
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const section = (title: string, body?: string) =>
  body ? [{ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${escape(body)}` } }] : [];

export function slackMessage(feedback: Feedback) {
  const setup = [
    feedback.version && `Proofmarks ${feedback.version}`,
    feedback.route,
    feedback.os,
    feedback.tool && `tool ${feedback.tool}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    text: `Proofmarks feedback (${feedback.kind}): ${feedback.summary}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${feedback.kind}: ${feedback.summary}`.slice(0, 150) } },
      ...section('What happened', feedback.details),
      ...section('Expected', feedback.expected),
      ...section('Proposed fix', feedback.proposedFix),
      ...(setup ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: escape(setup) }] }] : []),
    ],
  };
}
