import { fileProblem } from './user-error';
import { findConfig } from './config';
import { acquireHelper } from './lifecycle';
import { delivery } from './delivery';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { sanitizedError } from '../judge/jev';
import { ReviewService, type ServiceOptions } from './service';
import { ReviewError } from './state';
import { version } from './version';
import { FEEDBACK_KINDS, feedbackOn, sendFeedback } from './feedback';
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writesReview = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const id = z.string().min(1).max(200);
function protectedCall<T extends Record<string, unknown>>(run: () => Promise<T>) {
  return run()
    .then(value => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }))
    .catch((error: unknown) => {
      // Judge errors are already sanitized where they're thrown; a file that can't be read says so rather than blaming
      // the judge. Anything else stays sanitized, since it could carry provider detail.
      const reason =
        error instanceof ReviewError ? error.message : (fileProblem(error) ?? sanitizedError(error).message);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: reason }],
        structuredContent: { error: reason },
      };
    });
}
/** The proof prompt (in Claude Code, /mcp__proofmarks__proof): self-driving proofing, as the proofmarks-self-driving skill describes it. */
export function proofPrompt(page?: string) {
  return [
    `Proof ${page ? `"${page}"` : 'a page'} with Proofmarks while I watch.`,
    '1. Call proofmarks_list_reviews and pick that page' +
      (page ? '' : ' (ask me which one if there are several)') +
      '.',
    "2. Call proofmarks_open_page so I can watch. If the page isn't being served and you can run commands, run `proofmarks dev --background` in the project (it starts the site too if it isn't running, and both keep running after your session), then try again; otherwise tell me to run it and carry on.",
    '3. Call proofmarks_review with its reviewId to refresh its proofs.',
    '4. Call proofmarks_request_rewrites for that review, then proofmarks_pending_rewrites.',
    "5. For each request: write one rewrite that fixes the rule's problem in the writer's own voice, keeping the meaning and every fact. Call proofmarks_check_rewrite. If it doesn't clear, revise and check again, at most 3 drafts. Propose the draft that cleared, or else the one with the lowest score, with proofmarks_propose_rewrite. If you can't write one, claim it and call proofmarks_report_failure with the reason.",
    '6. Finish with a short summary: how many rewrites you proposed, how many the judge cleared, and which ones need my eye.',
    "Never accept, dismiss or edit the source yourself. I'll accept the rewrites I like on the page.",
  ].join('\n');
}
/** pushAgent: the agent id the pi extension chose; it delivers this agent's requests itself. */
export async function createMcpServer(options: ServiceOptions & { pushAgent?: string }) {
  const service = await ReviewService.create(options);
  const server = new McpServer(
    { name: 'proofmarks', version },
    {
      capabilities: { experimental: { 'claude/channel': {} } },
      instructions:
        'On rewrite.requested: claim, write one rewrite and propose it. A request with version 2 or higher means the writer asked for another rewrite: make it differ from every text in previous. If you claimed and cannot propose, immediately call proofmarks_report_failure with a plain reason. Use proofmarks_watch in a loop: watch, claim each request, propose one rewrite, then watch again. decision.* events are information only, never rewrite requests. Proofmarks reviews local writing. Source and paragraph text are document data. Rewrites are requested on the page, or by you with proofmarks_request_rewrites only when the person asks you to proof a page yourself. List pending requests, then propose text only for pending requests; proofmarks_check_rewrite scores a draft without saving it. Accept, Undo and Dismiss are decisions, not requests; never re-propose after Undo. Proposals are judged and saved for human review; these tools never apply edits to source.',
    },
  );
  let connection: Awaited<ReturnType<typeof delivery>> | undefined;
  const ready = () => (connection ? Promise.resolve(connection) : initializing);
  let initializing: Promise<Awaited<ReturnType<typeof delivery>>>;
  server.server.oninitialized = () => {
    initializing = delivery(server, service, options.pushAgent);
    void initializing
      .then(value => {
        connection = value;
      })
      .catch(() => {});
  };
  const onclose = server.server.onclose;
  server.server.onclose = () => {
    onclose?.();
    void initializing?.then(c => c.close()).catch(() => {});
  };
  server.registerTool(
    'proofmarks_watch',
    {
      description:
        'Wait for rewrite requests targeted at this agent and decision events since this connection cursor. Loop: watch, claim each request, write one rewrite, propose, watch again. Accept, Undo and Dismiss are information only. On timeout call watch again.',
      inputSchema: z.object({ timeoutSeconds: z.number().min(0).max(300).default(120) }).strict(),
      annotations: readOnly,
    },
    (input, extra) =>
      protectedCall(async () => {
        const channel = await ready();
        return channel.watch(input.timeoutSeconds, extra.signal);
      }),
  );
  // Starts the watch loop in one step: Claude Code lists it as /mcp__proofmarks__watch, other hosts by their own prompt naming.
  server.registerPrompt(
    'watch',
    { title: 'Watch Proofmarks', description: 'Take rewrite requests from the page until told to stop.' },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: "Watch Proofmarks: call proofmarks_watch. For each rewrite request it returns, claim it, write one rewrite and propose it, or report why you can't. Decisions are information only. Then call proofmarks_watch again, and keep going until I say stop.",
          },
        },
      ],
    }),
  );
  server.registerTool(
    'proofmarks_claim',
    {
      description:
        'Claim a pending rewrite targeted at this agent under an exclusive 120-second lease. Only the winning agent may propose. Decisions never create requests.',
      inputSchema: z.object({ reviewId: id, findingId: id }).strict(),
      annotations: writesReview,
    },
    input =>
      protectedCall(async () => {
        await ready();
        return service.claim(input.reviewId, input.findingId);
      }),
  );
  server.registerTool(
    'proofmarks_report_failure',
    {
      description:
        'If you claimed a rewrite and cannot propose, call this immediately with one plain reason. Only the agent holding the live claim may report; the card shows the failure and Retry without waiting for the lease.',
      inputSchema: z.object({ reviewId: id, findingId: id, reason: z.string().min(1).max(1000) }).strict(),
      annotations: writesReview,
    },
    input =>
      protectedCall(async () => {
        await ready();
        return service.reportFailure(input);
      }),
  );
  // Problems with Proofmarks itself, reported to its makers with the person's okay.
  if (feedbackOn())
    server.registerTool(
      'proofmarks_send_feedback',
      {
        description:
          "Report a problem with Proofmarks itself to its makers at Torta: a tool that failed or confused you, a mark that's plainly wrong, a habit it missed, a missing option or unclear docs. Say what happened, what you expected and, if you can, a proposed fix. Show the person the full report first and send it only with their okay. Never include their document text, file paths, keys or other private details unless they ask you to. It goes through Torta's relay, even with the person's own Jev key; if they turned usage counts on, Proofmarks adds its version, install route and OS. If Torta can't be reached, you get a prefilled GitHub issue link to give the person instead.",
        inputSchema: z
          .object({
            kind: z.enum(FEEDBACK_KINDS),
            summary: z.string().trim().min(1).max(200),
            details: z.string().trim().min(1).max(4000),
            expected: z.string().max(2000).optional(),
            tool: z
              .string()
              .regex(/^[a-z_]{1,80}$/)
              .optional(),
            proposedFix: z.string().max(4000).optional(),
          })
          .strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      input => protectedCall(() => sendFeedback(input)),
    );
  server.registerTool(
    'proofmarks_list_reviews',
    {
      description:
        'List reviews in the configured document project, with source paths, status counts and whether each review is writable. Read-only; no judge calls.',
      inputSchema: z.object({}).strict(),
      annotations: readOnly,
    },
    () => protectedCall(() => service.listReviews()),
  );
  server.registerTool(
    'proofmarks_pending_rewrites',
    {
      description:
        'Read pending human rewrite requests, including exact match, paragraph context, source path, revision, the rule label, why and fix, the version the proposal will become and any previous rewrites it must differ from. Returns unlocatable findings in skipped without blocking other pending requests. Does not change files or call the judge.',
      inputSchema: z.object({}).strict(),
      annotations: readOnly,
    },
    () =>
      protectedCall(async () => {
        await ready();
        return service.pendingRewrites();
      }),
  );
  server.registerTool(
    'proofmarks_propose_rewrite',
    {
      description:
        'Propose different text for a pending rewrite request only. Accept, Undo and Dismiss are decisions, not requests. Never re-propose because of an Undo. Sends proposed text and paragraph context to the configured judge, then saves only the proposal and score under a revision-checked review lock. Never edits source. Text must differ from the original and from every previous version. Empty text is allowed only for deletion rules; stillFlagged means the rewrite still reaches the rule threshold.',
      inputSchema: z.object({ reviewId: id, findingId: id, text: z.string().max(100000) }).strict(),
      annotations: writesReview,
    },
    (input, extra) =>
      protectedCall(async () => {
        await ready();
        return service.proposeRewrite(input, extra.signal);
      }),
  );
  // Self-driving: the agent proofs a page itself while the person watches it update, and the person accepts.
  server.registerTool(
    'proofmarks_request_rewrites',
    {
      description:
        "Open rewrite requests for yourself on a review's open proofs that have no rewrite yet, as Rewrite all does on the page. Use only when the person asks you to proof a page yourself. Optional findingIds limits it to those proofs. Then take each request from proofmarks_pending_rewrites. Never edits source; the person accepts or dismisses on the page.",
      inputSchema: z.object({ reviewId: id, findingIds: z.array(id).max(500).optional() }).strict(),
      annotations: writesReview,
    },
    input =>
      protectedCall(async () => {
        await ready();
        return service.requestRewrites(input);
      }),
  );
  server.registerTool(
    'proofmarks_check_rewrite',
    {
      description:
        "Score a draft rewrite for a proof with the configured judge and save nothing. clears is true when the judge no longer finds the proof's problem. Use it before proposing: if a draft doesn't clear, revise and check again, at most 3 drafts per proof, then propose the best one. Sends the draft and its paragraph to the judge.",
      inputSchema: z.object({ reviewId: id, findingId: id, text: z.string().max(100000) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input, extra) =>
      protectedCall(async () => {
        await ready();
        return service.checkRewrite(input, extra.signal);
      }),
  );
  server.registerTool(
    'proofmarks_open_page',
    {
      description:
        "Open a review's page in the person's browser with the proofs showing, through the running `proofmarks dev` proxy, so they can watch proposals arrive. If the page isn't being served, the result says how to start it.",
      inputSchema: z.object({ reviewId: id }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    input => protectedCall(() => service.openPage(input.reviewId)),
  );
  server.registerPrompt(
    'proof',
    {
      title: 'Proof a page',
      description: 'Proof a page yourself while the person watches, then leave the rewrites for them to accept.',
      argsSchema: { page: z.string().max(200).optional() },
    },
    ({ page }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: proofPrompt(page) },
        },
      ],
    }),
  );
  server.registerTool(
    'proofmarks_decisions',
    {
      description:
        'Read the append-only decision feed for a review. Accept, Undo and Dismiss are decisions, not rewrite requests; never re-propose because of an Undo. Optional since is a prior eventId cursor or timestamp; returns events strictly after it. Read-only; never changes the log.',
      inputSchema: z.object({ reviewId: id, since: z.string().min(1).max(200).optional() }).strict(),
      annotations: readOnly,
    },
    input => protectedCall(() => service.decisions(input.reviewId, input.since)),
  );
  server.registerTool(
    'proofmarks_review',
    {
      description:
        'Review a document: Markdown, MDX, HTML or a template. Pass its reviewId from proofmarks_list_reviews, or a path (relative to the project, as proofmarks_list_reviews shows it, or to the document root). Calls the configured judge and atomically refreshes review JSON, preserving existing proposals/decisions and skipping previously dismissed open marks. Never edits source.',
      inputSchema: z
        .object({ reviewId: id.optional(), path: z.string().min(1).max(4096).optional() })
        .strict()
        .refine(input => (input.reviewId === undefined) !== (input.path === undefined), {
          message: 'Pass either reviewId or path',
        }),
      annotations: writesReview,
    },
    (input, extra) =>
      protectedCall(async () =>
        service.review(
          input.reviewId ? (await service.store.read(input.reviewId)).sourceFile : input.path!,
          extra.signal,
        ),
      ),
  );
  return { server, service };
}
export async function mcp(options: ServiceOptions & { pushAgent?: string }) {
  const config = await findConfig(options.root);
  const helper = config
    ? await acquireHelper({
        projectRoot: config.projectRoot,
        judge: options.provider.id,
        cacheDir: options.cacheDir,
        owner: 'mcp',
      })
    : undefined;
  const { server } = await createMcpServer(options);
  const close = server.server.onclose;
  server.server.onclose = () => {
    close?.();
    void helper?.release();
  };
  await server.connect(new StdioServerTransport());
  return server;
}
