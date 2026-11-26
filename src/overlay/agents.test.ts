import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentChoices, agentColors, agentLabel, resolvedTarget, rewriteState } from './agents';
import { mockAgents } from './fixtures/agents';
import type { ProofmarksFinding } from './types';
const agents = mockAgents(),
  now = Date.parse('November 6, 2026 12:04:00');
const finding: ProofmarksFinding = {
  id: 'F',
  rule: 'r',
  match: 'Original.',
  rewriteRequest: { status: 'pending', target: 'mock-claude', requestedAt: new Date(now - 1000).toISOString() },
};
test('only actual available headless targets appear, with truthful selected delivery and plain host labels', () => {
  const data = { ...agents, headless: [...agents.headless, { id: 'headless:pi', label: 'pi', available: false }] };
  assert.equal(agentChoices(data).length, 4);
  assert.equal(agentChoices(data)[0]!.delivery, 'Pushes to the conversation');
  assert.equal(agentChoices(data)[1]!.delivery, 'Waiting in watch mode');
  assert.equal(agentChoices(data)[2]!.delivery, 'Runs without a conversation');
  assert.equal(agentLabel('mock-claude', data), 'Claude Code');
  assert.equal(resolvedTarget(data), 'mock-claude');
  assert.equal(agentLabel('headless:codex'), 'Codex');
});
test('sent, claimed, failed, stalled and proposed states are derived from request facts', () => {
  assert.equal(rewriteState(finding, agents, now).message, 'Sent to Claude Code');
  assert.equal(
    rewriteState({ ...finding, rewriteRequest: { status: 'pending' } }, agents, now).message,
    'Sent to your agent',
  );
  const claimed = { ...finding, rewriteRequest: { ...finding.rewriteRequest!, status: 'claimed' as const } };
  assert.equal(rewriteState(claimed, agents, now).message, 'Claude Code is writing');
  assert.equal(
    rewriteState(finding, agents, now + 30_000).message,
    "Claude Code hasn't picked this up. Is it watching?",
  );
  assert.equal(rewriteState(claimed, agents, now + 30_000).stalled, false);
  assert.equal(rewriteState(finding, { ...agents, agents: [] }, now + 30_000).stalled, true);
  const failed = {
    ...finding,
    rewriteRequest: { ...finding.rewriteRequest!, status: 'failed' as const, error: 'The companion stopped.' },
  };
  assert.equal(rewriteState(failed, agents, now).message, 'The companion stopped.');
  assert.equal(rewriteState(failed, agents, now).retry, true);
  assert.equal(rewriteState({ ...finding, proposed: 'A proposal.' }, agents, now + 30_000).message, '');
  assert.equal(rewriteState({ ...finding, status: 'accepted' }, agents, now + 30_000).waiting, false);
});
test('headless and unknown timestamps never pretend a conversation is watching', () => {
  assert.equal(
    rewriteState(
      {
        ...finding,
        rewriteRequest: {
          status: 'pending',
          target: 'headless:claude',
          requestedAt: new Date(now - 60_000).toISOString(),
        },
      },
      agents,
      now,
    ).stalled,
    false,
  );
  assert.equal(
    rewriteState(
      { ...finding, rewriteRequest: { status: 'pending', target: 'mock-claude', requestedAt: 'invalid' } },
      agents,
      now,
    ).stalled,
    false,
  );
  assert.equal(
    rewriteState(finding, agents, now, 'The request could not reach the server.').message,
    'The request could not reach the server.',
  );
});

test("an agent's working line takes its color, and an unknown agent keeps the rule's ink", () => {
  assert.equal(rewriteState(finding, agents, now).color, '#d97757');
  for (const [target, color] of [
    ['headless:claude', '#d97757'],
    ['headless:codex', '#7aa2f7'],
    ['headless:pi', '#f09082'],
  ])
    assert.equal(rewriteState({ ...finding, rewriteRequest: { status: 'pending', target } }, agents, now).color, color);
  assert.equal(
    rewriteState({ ...finding, rewriteRequest: { status: 'pending', target: 'someone' } }, agents, now).color,
    undefined,
  );
  // Every color stays readable on the card's ink (#24201c), the line's own contrast floor.
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  for (const color of Object.values(agentColors))
    assert.ok((luminance(color!) + 0.05) / (luminance('#24201c') + 0.05) >= 4.5, color);
});
