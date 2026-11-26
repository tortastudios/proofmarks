import { installToken, relayUrl, telemetryOn, type InstallOptions } from '../judge/relay';
import type { ProofmarksFinding } from '../overlay/types';

/**
 * Decision counts: when someone keeps, dismisses or undoes a mark, the relay counts the rule, what
 * they did, Jev's score rounded down to 0.05 and the line the mark was shown under. Never the text, the page, the file
 * or who. Added up across installs, these show where each rule's calibrated line should sit for everyone. They go
 * through the relay only, and only once the person turned usage counts on (`proofmarks telemetry on`).
 */
export type DecisionCount = {
  rule: string;
  action: 'kept' | 'dismissed' | 'undone' | 'restored';
  score: number;
  line: number;
  model: string;
  rulesVersion: string;
};

/** The count for a person's call on a mark, given the mark as it was before; nothing for a mark Jev didn't score. */
export function decisionCount(
  action: 'accept' | 'dismiss' | 'revert' | 'restore',
  finding: ProofmarksFinding,
): DecisionCount | undefined {
  const judge = finding.judge,
    score = judge?.probability ?? judge?.score;
  if (typeof score !== 'number' || typeof judge?.threshold !== 'number' || !judge.model || !judge.rulesVersion)
    return undefined;
  const counted =
    action === 'accept'
      ? 'kept'
      : action === 'dismiss'
        ? 'dismissed'
        : action === 'restore' || finding.status === 'dismissed'
          ? 'restored'
          : finding.status === 'accepted'
            ? 'undone'
            : undefined;
  if (!counted) return undefined;
  return {
    rule: finding.rule,
    action: counted,
    score: Math.floor(score * 20 + 1e-9) / 20,
    line: Math.round(judge.threshold * 100) / 100,
    model: judge.model,
    rulesVersion: judge.rulesVersion,
  };
}

/** Sends one count to the relay. Counting never gets in the way: failures are dropped. */
export async function sendDecisionCount(count: DecisionCount, install: InstallOptions) {
  if (!telemetryOn() || install.telemetry === false) return;
  const relay = install.relay ?? relayUrl();
  try {
    const token = await installToken({ ...install, relay });
    // Counts turned off while the token was on its way: nothing is sent.
    if (!telemetryOn()) return;
    await (install.request ?? fetch)(`${relay}/v1/decisions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(count),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* A count that can't be sent is dropped. */
  }
}
