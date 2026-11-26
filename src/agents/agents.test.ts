import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eventFixture } from '../events/fixture';
import { registerAgent, liveAgents, agentStatus, selectTarget, stateDirectory } from './index';
test('registry uses live pid/heartbeat, newest conversation, saved selection and honest headless availability', async () => {
  const f = await eventFixture(),
    a = await registerAgent(f.base, { name: 'claude-code', version: 'test' }),
    b = await registerAgent(f.base, { name: 'codex', version: 'test' });
  try {
    assert.equal((await agentStatus(f.base)).resolvedTarget, b.agent.id);
    await selectTarget(f.base, a.agent.id);
    assert.equal((await agentStatus(f.base)).resolvedTarget, a.agent.id);
    await writeFile(
      path.join(await stateDirectory(f.base, 'agents'), a.agent.id + '.json'),
      JSON.stringify({ ...a.agent, lastSeenAt: 'January 1, 2000' }),
    );
    assert.equal((await liveAgents(f.base)).length, 1);
    assert.equal((await agentStatus(f.base)).resolvedTarget, b.agent.id);
    await assert.rejects(selectTarget(f.base, a.agent.id), /connected/);
    await b.close();
    const status = await agentStatus(f.base);
    assert.equal(status.agents.length, 0);
    assert.equal(status.resolvedTarget, status.headless.find(h => h.available)?.id ?? null);
  } finally {
    await a.close();
    await b.close();
    await f.close();
  }
});
