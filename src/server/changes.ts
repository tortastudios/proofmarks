import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/index';
import { agentStatus, stateDirectory } from '../agents/index';
import { readReview } from './source';

/**
 * A page's change stream: server-sent events that tell the page when to fetch, so it never polls while
 * nothing happens. `review` when the review's revision changes (its findings, decision log or source file), `agents`
 * when the connected agents or the selected target change. `ready` arrives first, so a page can tell a working stream
 * from one a proxy holds back, and a comment every 15 s keeps the connection open.
 */
export function changeStream(projectRoot: string, request: Request, reviewId?: string) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false,
        revision: string | undefined,
        agents: string | undefined,
        timer: ReturnType<typeof setTimeout> | undefined;
      const closers: (() => void)[] = [];
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        for (const close of closers) close();
        try {
          controller.close();
        } catch {
          /* Already closed by the reader. */
        }
      };
      // The agents' own heartbeats rewrite their records every 10 s; only a change a page would show counts.
      const agentPrint = async () =>
        JSON.stringify(await agentStatus(projectRoot), (key, value) => (key === 'lastSeenAt' ? undefined : value));
      const check = async () => {
        if (closed) return;
        try {
          const next = reviewId ? (await readReview(projectRoot, reviewId)).revision : undefined;
          if (revision !== undefined && next !== revision) send('event: review\ndata: {}\n\n');
          revision = next;
        } catch {
          /* Mid-write; the next change retries. */
        }
        try {
          const next = await agentPrint();
          if (agents !== undefined && next !== agents) send('event: agents\ndata: {}\n\n');
          agents = next;
        } catch {
          /* Same. */
        }
      };
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void check(), 100);
      };
      request.signal.addEventListener('abort', stop, { once: true });
      await check();
      const document = (await loadConfig(projectRoot)).documents.find(entry => entry.id === reviewId);
      const folders = new Set([
        await stateDirectory(projectRoot),
        await stateDirectory(projectRoot, 'agents'),
        ...(document ? [path.dirname(document.reviewPath), path.dirname(document.sourcePath)] : []),
      ]);
      for (const folder of folders) {
        try {
          const watcher = watch(folder, { persistent: false }, soon);
          watcher.on('error', () => watcher.close());
          closers.push(() => watcher.close());
        } catch {
          /* The 2 s look below still notices. */
        }
      }
      // File events can arrive late or not at all (a busy machine, network or container folders), so the review's own
      // files are also looked at every 2 s; only a change in their size or time leads to a full check.
      const files = document ? [document.sourcePath, document.reviewPath, document.logPath] : [];
      const stamp = async () =>
        (
          await Promise.all(
            files.map(file =>
              stat(file).then(
                info => `${info.mtimeMs}:${info.size}`,
                () => '-',
              ),
            ),
          )
        ).join('|');
      let stamped = await stamp();
      const look = setInterval(
        () =>
          void stamp().then(next => {
            if (next !== stamped) {
              stamped = next;
              soon();
            }
          }),
        2000,
      );
      // Also catches what no file event reports, such as an agent whose process ended without removing its record.
      const beat = setInterval(() => {
        send(': keep-alive\n\n');
        void check();
      }, 15000);
      closers.push(
        () => clearInterval(look),
        () => clearInterval(beat),
      );
      send('retry: 3000\nevent: ready\ndata: {}\n\n');
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
