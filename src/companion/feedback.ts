import { installToken, relayUrl, telemetryOn } from '../judge/relay';
import { installRoute, version } from './version';

/**
 * The agent feedback tool: a problem report with an optional proposed fix, sent to Torta through the relay,
 * where it lands in Slack. Without the relay (offline, say), the agent gets a prefilled GitHub issue link instead, so
 * nothing is sent behind anyone's back. PROOFMARKS_FEEDBACK=0 removes the tool.
 */
export const FEEDBACK_KINDS = ['bug', 'wrong-mark', 'missed-habit', 'confusing-tool', 'feature', 'docs'] as const;
export type FeedbackReport = {
  kind: (typeof FEEDBACK_KINDS)[number];
  summary: string;
  details: string;
  expected?: string;
  tool?: string;
  proposedFix?: string;
};
export const feedbackOn = (env: NodeJS.ProcessEnv = process.env) =>
  !['0', 'off', 'false', 'no'].includes((env.PROOFMARKS_FEEDBACK ?? '').trim().toLowerCase());

/** A GitHub issue with the report filled in, for the person to read and submit themselves. */
export function issueUrl(report: FeedbackReport) {
  const body = [
    `**Kind:** ${report.kind}${report.tool ? ` (tool ${report.tool})` : ''}`,
    '',
    '**What happened**',
    report.details,
    ...(report.expected ? ['', '**Expected**', report.expected] : []),
    ...(report.proposedFix ? ['', '**Proposed fix**', report.proposedFix] : []),
    '',
    `Proofmarks ${version}`,
  ].join('\n');
  return `https://github.com/tortastudios/proofmarks/issues/new?${new URLSearchParams({ title: report.summary, body: body.slice(0, 6000) })}`;
}

export async function sendFeedback(
  report: FeedbackReport,
  deps: { relay?: string; telemetry?: boolean; file?: string; request?: typeof fetch } = {},
) {
  const relay = deps.relay ?? relayUrl(),
    request = deps.request ?? fetch;
  try {
    // The choice about counts is read again once the token is in hand, since it can change while the token is on its way.
    let telemetry: boolean, token: string;
    do {
      telemetry = deps.telemetry ?? telemetryOn();
      token = await installToken({ relay, telemetry, version, route: installRoute(), file: deps.file, request });
    } while ((deps.telemetry ?? telemetryOn()) !== telemetry);
    // Unless the person turned usage counts on, a report carries only what the agent wrote, nothing about the install.
    const setup = telemetry ? { version, route: installRoute(), os: `${process.platform}-${process.arch}` } : {};
    const response = await request(`${relay}/v1/feedback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...report, ...setup }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return { sent: true, to: "Torta's Proofmarks channel" };
    if (response.status === 429)
      return {
        sent: false,
        reason:
          'This install has sent its feedback for today. To send this one anyway, the person can open the issue link.',
        issueUrl: issueUrl(report),
      };
  } catch {
    /* Offline or no relay: fall through to the issue link. */
  }
  return {
    sent: false,
    reason: "Couldn't reach Torta's relay. The person can open this prefilled GitHub issue instead.",
    issueUrl: issueUrl(report),
  };
}
