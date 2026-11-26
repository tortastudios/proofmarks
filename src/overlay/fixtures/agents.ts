import type { ProofmarksAgents } from '../types';

/** Connected and headless agents for tests. */
export function mockAgents(): ProofmarksAgents {
  return {
    agents: [
      {
        id: 'mock-claude',
        host: 'claude-code',
        label: 'Claude Code',
        project: 'writing-project',
        startedAt: 'November 6, 2026 12:03:00',
        delivery: 'push',
      },
      {
        id: 'mock-codex',
        host: 'codex',
        label: 'Codex',
        project: 'writing-project',
        startedAt: 'November 6, 2026 12:12:00',
        delivery: 'watch',
      },
    ],
    headless: [
      { id: 'headless:claude', label: 'Claude Code', available: true },
      { id: 'headless:codex', label: 'Codex', available: true },
    ],
    target: 'mock-claude',
    resolvedTarget: 'mock-claude',
  };
}
