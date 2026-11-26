import { EventEmitter } from 'node:events';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgent } from '../agents/index';
import { eventFeed, watchLogs, expireClaims, targetedEvents } from '../events/index';
import type { ReviewService } from './service';
/** external: an agent id whose host pushes requests itself (the pi extension), so this server only registers it as push. */
export async function delivery(server: McpServer, service: ReviewService, external?: string) {
  const client = server.server.getClientVersion() ?? { name: 'other', version: 'unknown' };
  const registry = await registerAgent(
    service.store.projectBase,
    client,
    external || client.name.toLowerCase().includes('claude') ? 'push' : 'manual',
    external,
  );
  const resting = registry.agent.delivery;
  service.options.agent = registry.agent.id;
  const wake = new EventEmitter();
  let cursor: Record<string, string> = (await eventFeed(service.store)).cursor,
    closed = false,
    pushing = false,
    watching = false,
    generation = 0;
  const scan = async () => {
    if (closed) return;
    generation++;
    wake.emit('change');
    if (registry.agent.delivery !== 'push' || external || pushing) return;
    pushing = true;
    const observed = generation;
    try {
      const feed = await eventFeed(service.store, cursor);
      for (const event of await targetedEvents(service.store, feed.events, registry.agent.id)) {
        await server.server.notification({
          method: 'notifications/claude/channel',
          params: {
            content: JSON.stringify(event),
            meta: { kind: event.type, review: event.reviewId, finding: event.findingId },
          },
        });
      }
      cursor = feed.cursor;
    } catch {
      /* A journal may be in the middle of an append; next change retries. */
    } finally {
      pushing = false;
      if (generation !== observed && !closed) void scan();
    }
  };
  const unwatch = watchLogs(service.store, () => void scan());
  const leases = setInterval(() => void expireClaims(service.store).catch(() => {}), 10000);
  leases.unref();
  async function watch(timeoutSeconds: number, signal?: AbortSignal) {
    if (watching) throw new Error('Only one watch can be open per agent');
    watching = true;
    await registry.delivery('watch');
    const deadline = Date.now() + timeoutSeconds * 1000;
    try {
      for (;;) {
        if (closed) return { timeout: true };
        const observed = generation;
        signal?.throwIfAborted();
        await expireClaims(service.store);
        const feed = await eventFeed(service.store, cursor),
          pending = await service.pendingRewrites();
        const events = feed.events.filter(
          e => e.type.startsWith('decision.') && (!e.target || e.target === registry.agent.id),
        );
        cursor = feed.cursor;
        if (pending.pending.length || pending.skipped.length || events.length) return { ...pending, events, cursor };
        if (generation !== observed) continue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { timeout: true };
        await new Promise<void>((resolve, reject) => {
          const done = () => {
              cleanup();
              resolve();
            },
            abort = () => {
              cleanup();
              reject(new Error('Watch cancelled'));
            },
            timer = setTimeout(done, remaining);
          const cleanup = () => {
            clearTimeout(timer);
            wake.off('change', done);
            signal?.removeEventListener('abort', abort);
          };
          wake.once('change', done);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      }
    } finally {
      watching = false;
      await registry.delivery(resting);
    }
  }
  return {
    registry,
    watch,
    async close() {
      closed = true;
      unwatch();
      clearInterval(leases);
      wake.emit('change');
      await registry.close();
    },
  };
}
