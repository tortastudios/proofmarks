import { readFile } from 'node:fs/promises';
import { adapterFor, matchRegion, inferFormat } from '../adapters/index';
import { expireClaims, claim, updateRequest } from '../events/index';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  bodyStart,
  compileLexicon,
  lexiconHits,
  loadRegistry,
  PATTERNS,
  projectMdx,
  projectText,
  PREAMBLE,
  sentences,
  type Rule,
} from '../detect/index';
import type { JudgeProvider, Question } from '../judge/types';
import { loadCalibration } from '../judge/calibration';
import { runJudge } from '../judge/runner';
import { ReviewError, ReviewStore, type ReviewFinding, type Snapshot } from './state';
import { reviewFile } from './review';
import { nextVersion, rewriteVersions } from '../versions';
import { devPage, openInBrowser, pagePath } from './dev-page';
import { storeStrictness } from './strictness';
/** openUrl opens a page for the person; tests pass their own so no browser opens. */
export type ServiceOptions = {
  root: string;
  provider: JudgeProvider;
  cacheDir?: string;
  agent?: string;
  openUrl?: (url: string) => void;
  /** How the service asks the running site whether a page exists; tests pass their own. */
  request?: typeof fetch;
};
// Where the match sits in its paragraph's text: the occurrence nearest its place in the source.
function offsetIn(paragraph: string, match: string, near: number) {
  let best = -1;
  for (let at = paragraph.indexOf(match); at >= 0; at = paragraph.indexOf(match, at + 1))
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at;
  return best;
}
function locate(snapshot: Snapshot, finding: ReviewFinding) {
  const source = snapshot.source;
  const format = inferFormat(snapshot.sourceFile);
  if (format === 'html' || format === 'jinja') {
    const span = matchRegion(source, finding.match, format);
    const region = adapterFor(format)
      .regions(source)
      .find(r => r.editable && r.start <= span.start && r.end >= span.end);
    if (!region) throw new ReviewError('Finding paragraph is no longer available');
    return {
      paragraph: region.text,
      start: span.start,
      offset: offsetIn(region.text, finding.match, span.start - region.start),
    };
  }
  let start = finding.span?.start;
  if (start === undefined || source.slice(start, start + finding.match.length) !== finding.match) {
    // Spans go stale once another proof is accepted. Search the body only: a verbatim frontmatter copy is a hidden copy, not a second match.
    start = source.indexOf(finding.match, bodyStart(source));
    if (start < 0 || source.indexOf(finding.match, start + 1) >= 0)
      throw new ReviewError('Finding no longer has an exact unique source match');
  }
  const block = projectMdx(source).find(b => b.start <= start && b.end >= start + finding.match.length);
  if (!block) throw new ReviewError('Finding paragraph is no longer available');
  return { paragraph: block.text, start, offset: offsetIn(block.text, finding.match, start - block.start) };
}
// The mark's sentence with the rewrite in place, and where the new words sit in it.
function rewrittenSentence(paragraph: string, offset: number, match: string, text: string) {
  if (offset < 0) return undefined;
  const sentence = sentences({ text: paragraph }).find(s => s.start <= offset && s.end >= offset + match.length);
  if (!sentence) return undefined;
  const before = paragraph.slice(sentence.start, offset).trimStart();
  return {
    sentence: (before + text + paragraph.slice(offset + match.length, sentence.end)).trimEnd(),
    start: before.length,
    end: before.length + text.length,
  };
}
/**
 * What a word-level pattern (em dash, bold) still finds in the new words once the rewrite is in place: each hit's own
 * text and its sentence. The pattern reads the paragraph's source, so bold's asterisks count. Undefined when the mark
 * can't be placed in its paragraph.
 */
function patternRewrite(
  snapshot: Snapshot,
  { paragraph, start, offset }: ReturnType<typeof locate>,
  match: string,
  text: string,
  pattern: string,
) {
  const format = inferFormat(snapshot.sourceFile);
  let raw: string, at: number, project: typeof projectMdx;
  if (format === 'html' || format === 'jinja') [raw, at, project] = [paragraph, offset, projectText];
  else {
    const block = projectMdx(snapshot.source).find(b => b.start <= start && b.end >= start + match.length);
    if (!block) return undefined;
    [raw, at, project] = [snapshot.source.slice(block.start, block.end), start - block.start, projectMdx];
  }
  if (at < 0) return undefined;
  const after = raw.slice(0, at) + text + raw.slice(at + match.length);
  return project(after).flatMap(block => {
    const sents = sentences(block);
    return PATTERNS[pattern]!({ block, sentences: sents, source: after })
      .filter(hit => block.map[hit.start]! < at + text.length && block.map[hit.end - 1]! >= at)
      .map(hit => ({
        term: block.text.slice(hit.start, hit.end),
        sentence: sents.find(s => s.start <= hit.start && s.end >= hit.end)?.text ?? block.text,
      }));
  });
}
export class ReviewService {
  constructor(
    readonly store: ReviewStore,
    readonly options: ServiceOptions,
  ) {}
  static async create(options: ServiceOptions) {
    return new ReviewService(await ReviewStore.create(options.root), options);
  }
  async listReviews() {
    return { reviews: await this.store.list() };
  }
  async pendingRewrites() {
    await expireClaims(this.store);
    const registry = loadRegistry();
    const pending = [];
    const skipped: { reviewId: string; findingId: string; reason: string }[] = [];
    for (const entry of await this.store.list()) {
      if (!entry.writable) continue;
      const snapshot = await this.store.read(entry.reviewId);
      for (const finding of snapshot.review!.findings) {
        if (
          finding.rewriteRequest?.status !== 'pending' ||
          (finding.rewriteRequest.target && finding.rewriteRequest.target !== this.options.agent) ||
          (finding.status ?? 'open') !== 'open'
        )
          continue;
        try {
          const rule = registry.rules.find(rule => rule.id === finding.rule);
          if (!rule) throw new ReviewError('Finding rule is not registered');
          const previous = rewriteVersions(finding).map(v => v.text);
          pending.push({
            reviewId: entry.reviewId,
            findingId: finding.id,
            version: finding.rewriteRequest.version ?? nextVersion(finding),
            ...(previous.length ? { previous } : {}),
            revision: snapshot.revision,
            source: snapshot.review!.source,
            path: snapshot.sourceFile,
            match: finding.match,
            paragraph: locate(snapshot, finding).paragraph,
            rule: { id: rule.id, label: rule.label, why: rule.why, fix: rule.fix, edit: rule.edit, level: rule.level },
          });
        } catch (error) {
          skipped.push({
            reviewId: entry.reviewId,
            findingId: finding.id,
            reason: error instanceof ReviewError ? error.message : 'This proof could not be located in the source',
          });
        }
      }
    }
    return { pending, skipped };
  }
  async proposeRewrite(input: { reviewId: string; findingId: string; text: string }, signal?: AbortSignal) {
    const snapshot = await this.store.read(input.reviewId);
    this.store.assertMutable(snapshot);
    const finding = snapshot.review!.findings.find(f => f.id === input.findingId);
    if (!finding) throw new ReviewError('Finding does not exist');
    if ((finding.status ?? 'open') !== 'open') throw new ReviewError('Finding is already resolved');
    const request = finding.rewriteRequest,
      agent = this.options.agent ?? 'agent';
    if (
      !request ||
      (request.target && request.target !== agent) ||
      !(
        request.status === 'pending' ||
        (request.status === 'claimed' &&
          request.claimedBy === agent &&
          Date.now() - Date.parse(request.claimedAt ?? '') < 120000)
      )
    )
      throw new ReviewError(
        'No pending rewrite request. Accept, Undo and Dismiss are decisions, not requests; wait for a new rewrite request.',
      );
    const registry = loadRegistry();
    const rule = registry.rules.find(rule => rule.id === finding.rule);
    if (!rule) throw new ReviewError('Finding rule is not registered');
    if (!input.text.trim() && rule.edit !== 'delete') throw new ReviewError('Rewrite must not be empty');
    if (input.text.trim() === finding.match.trim()) throw new ReviewError('Rewrite must differ from the original');
    const versions = rewriteVersions(finding);
    if (versions.some(v => v.text.trim() === input.text.trim()))
      throw new ReviewError('Rewrite must differ from every earlier version');
    const { after, stillFlagged } = await this.score(snapshot, finding, rule, input.text, signal);
    const version = request.version ?? nextVersion(finding),
      proposedAt = new Date().toISOString();
    // Other proposals can land while this one is judged, so verify the source and request against the fresh review.
    await updateRequest(
      this.store,
      input.reviewId,
      input.findingId,
      (current, fresh) => {
        const live = current.rewriteRequest;
        if (fresh.source !== snapshot.source)
          throw new ReviewError('Source changed while the rewrite was judged; ask again');
        if (
          (current.status ?? 'open') !== 'open' ||
          !live ||
          live.requestedAt !== request.requestedAt ||
          (live.version ?? nextVersion(current)) !== version ||
          !(live.status === 'pending' || (live.status === 'claimed' && live.claimedBy === agent))
        )
          throw new ReviewError(
            'No pending rewrite request. Accept, Undo and Dismiss are decisions, not requests; wait for a new rewrite request.',
          );
        const { stillFlagged: _earlier, ...rest } = live;
        return {
          ...current,
          proposed: input.text,
          proposals: [
            ...rewriteVersions(current),
            { version, text: input.text, by: agent, proposedAt, ...(stillFlagged ? { stillFlagged: true } : {}) },
          ],
          rewriteRequest: {
            ...rest,
            status: 'proposed',
            version,
            proposedAt,
            by: agent,
            ...(stillFlagged ? { stillFlagged: true } : {}),
          },
          judge: { ...current.judge, after },
        };
      },
      'rewrite.proposed',
    );
    return { after, stillFlagged, version };
  }
  /**
   * Scores candidate text for a proof and saves nothing, so an agent can try again before proposing. The same
   * rule, threshold and paragraph context as a proposal; clears means Jev no longer finds the rule's problem.
   */
  async checkRewrite(input: { reviewId: string; findingId: string; text: string }, signal?: AbortSignal) {
    const snapshot = await this.store.read(input.reviewId);
    const finding = snapshot.review!.findings.find(f => f.id === input.findingId);
    if (!finding) throw new ReviewError('Finding does not exist');
    if ((finding.status ?? 'open') !== 'open') throw new ReviewError('Finding is already resolved');
    const rule = loadRegistry().rules.find(rule => rule.id === finding.rule);
    if (!rule) throw new ReviewError('Finding rule is not registered');
    if (!input.text.trim() && rule.edit !== 'delete') throw new ReviewError('Rewrite must not be empty');
    if (input.text.trim() === finding.match.trim()) throw new ReviewError('Rewrite must differ from the original');
    const { after, threshold, stillFlagged } = await this.score(snapshot, finding, rule, input.text, signal);
    return { probability: after.probability, threshold, clears: !stillFlagged };
  }
  /**
   * Opens rewrite requests for this agent on a review's open proofs that have no rewrite yet, as Rewrite all does on the
   * page. For self-driving, when the person asks the agent to proof a page itself. Each request is logged,
   * so the page shows it on the way.
   */
  async requestRewrites(input: { reviewId: string; findingIds?: string[] }) {
    const agent = this.options.agent ?? 'agent';
    const snapshot = await this.store.read(input.reviewId);
    this.store.assertMutable(snapshot);
    const why = (finding: ReviewFinding) =>
      (finding.status ?? 'open') !== 'open'
        ? 'Already decided'
        : finding.proposed !== undefined
          ? 'Already has a rewrite'
          : ['pending', 'claimed'].includes(finding.rewriteRequest?.status ?? '')
            ? 'A rewrite is already on the way'
            : undefined;
    const requested: string[] = [],
      skipped: { findingId: string; reason: string }[] = [];
    for (const findingId of input.findingIds ?? []) {
      if (!snapshot.review!.findings.some(f => f.id === findingId))
        skipped.push({ findingId, reason: 'No such proof' });
    }
    for (const finding of snapshot.review!.findings) {
      if (input.findingIds && !input.findingIds.includes(finding.id)) continue;
      const reason = why(finding);
      if (reason) {
        if (input.findingIds) skipped.push({ findingId: finding.id, reason });
        continue;
      }
      const requestedAt = new Date().toISOString();
      const after = await updateRequest(
        this.store,
        input.reviewId,
        finding.id,
        current =>
          why(current)
            ? undefined
            : {
                ...current,
                rewriteRequest: {
                  status: 'pending',
                  version: nextVersion(current),
                  requestedAt,
                  target: agent,
                  requestedBy: agent,
                },
              },
        'rewrite.requested',
      );
      if (after.rewriteRequest?.requestedAt === requestedAt) requested.push(finding.id);
      else skipped.push({ findingId: finding.id, reason: why(after) ?? 'Changed while requesting' });
    }
    return { requested, skipped };
  }
  /** Opens a review's page in the person's browser, through the running `proofmarks dev` proxy. */
  async openPage(reviewId: string) {
    const config = this.store.config;
    const document = config?.documents.find(entry => entry.id === reviewId);
    if (!config || !document) throw new ReviewError('Review is not in this project');
    const base = await devPage(config.projectRoot);
    if (!base)
      return {
        opened: false,
        reason:
          "The page isn't being served. Start it with `proofmarks dev --background` in the project, then call this again.",
      };
    const where = await pagePath(
      document.url,
      path.relative(config.projectRoot, document.sourcePath),
      await readFile(document.sourcePath, 'utf8').catch(() => ''),
      base,
      this.options.request,
    );
    if (!where)
      return {
        opened: false,
        reason: `Couldn't find this page on the site: its url in proofmarks.config.json, ${document.url}, is a pattern. Open ${base}, go to the page, and set that url to its path.`,
      };
    const url = new URL(where, base);
    url.searchParams.set('proof', '1');
    (this.options.openUrl ?? openInBrowser)(url.href);
    return { opened: true, url: url.href };
  }
  /** Jev's score for text standing in for a proof: the proof's rule, this site's line for it and paragraph context. */
  private async score(snapshot: Snapshot, finding: ReviewFinding, rule: Rule, text: string, signal?: AbortSignal) {
    const registry = loadRegistry();
    const located = locate(snapshot, finding),
      { paragraph: context, offset } = located;
    const ask = (term: string, id: string): Question => {
      const fill = (value: string) => value.replaceAll('{term}', term);
      return {
        id,
        kind: 'yes-no',
        ask: PREAMBLE + fill(rule.judge?.ask ?? `Does target still have this problem: ${rule.why}`),
        yes: fill(rule.judge?.yes ?? rule.why),
        no: fill(rule.judge?.no ?? rule.fix),
      };
    };
    const provider = this.options.provider;
    let threshold = finding.judge?.threshold;
    let repeats = 1;
    try {
      const calibration = await loadCalibration(provider.id, provider.model);
      if (calibration.rulesVersion !== registry.version) throw new ReviewError('Calibration rules version mismatch');
      threshold = calibration.rules[rule.id]?.threshold ?? threshold;
      repeats = calibration.rules[rule.id]?.repeats ?? 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (threshold === undefined || !Number.isFinite(threshold))
      throw new ReviewError('A calibrated threshold is required to score a rewrite');
    // A rewrite clears this site's line for the rule, the same line its marks are held to.
    threshold = (await storeStrictness(this.store, { [rule.id]: threshold }))[0]!.line;
    const nothingToJudge = {
      after: { probability: 0, provider: provider.id, model: provider.model },
      threshold,
      stillFlagged: false,
    };
    // The relay cannot score an empty passage; deleting the mark clears it without a judge call.
    if (!text.trim()) return nothingToJudge;
    let target: string, questions: Question[], found: ReturnType<typeof patternRewrite>;
    const rewritten =
      rule.detector.kind === 'lexicon' && rule.level === 'word'
        ? rewrittenSentence(context, offset, finding.match, text)
        : undefined;
    if (rule.detector.kind === 'lexicon' && rewritten) {
      // Only listed words remaining in the rewritten sentence need judging, just as in the original detection.
      const listed = lexiconHits(rewritten.sentence, compileLexicon(rule.detector.terms)).filter(
        hit => hit.start < rewritten.end && hit.end > rewritten.start,
      );
      if (!listed.length) return nothingToJudge;
      target = rewritten.sentence;
      questions = listed.map((hit, i) => ask(hit.text, `${rule.id}__${i}`));
    } else if (
      rule.detector.kind === 'pattern' &&
      rule.level === 'word' &&
      (found = patternRewrite(snapshot, located, finding.match, text, rule.detector.pattern))
    ) {
      // A word-level pattern mark takes the same two steps: its pattern runs again with the rewrite in place,
      // and only what it still finds there is judged, in its sentence. The replacement alone, such as ", but" for an em
      // dash, can't be judged: the paragraph around it still holds the dash.
      if (!found.length) return nothingToJudge;
      target = found[0]!.sentence;
      questions = found.map((hit, i) => ask(hit.term, `${rule.id}__${i}`));
    } else {
      const format = inferFormat(snapshot.sourceFile);
      target =
        format === 'html' || format === 'jinja'
          ? text
          : projectMdx(text)
              .map(block => block.text)
              .join('\n\n');
      if (!target.trim()) return nothingToJudge;
      questions = [
        ask(finding.focus ? finding.match.slice(finding.focus.start, finding.focus.end) : finding.match, rule.id),
      ];
    }
    const result = await runJudge(
      provider,
      { target, ...(rule.judge?.context === 'paragraph' ? { context } : {}) },
      questions,
      {
        cacheDir: this.options.cacheDir ?? path.join(homedir(), '.proofmarks/cache'),
        rulesVersion: registry.version,
        repeats,
        signal,
      },
    );
    const probability = Math.max(...result.answers.map(answer => answer.probability));
    const after = { probability, provider: provider.id, model: provider.model };
    const stillFlagged = after.probability >= threshold;
    return { after, threshold, stillFlagged };
  }
  async reportFailure(input: { reviewId: string; findingId: string; reason: string }) {
    const reason = input.reason.trim();
    if (!reason || reason.length > 1000 || /[\u0000-\u001f\u007f]/.test(reason))
      throw new ReviewError('Use one plain sentence explaining why the rewrite failed');
    const finding = await updateRequest(
      this.store,
      input.reviewId,
      input.findingId,
      f => {
        const request = f.rewriteRequest;
        if (
          (f.status ?? 'open') !== 'open' ||
          request?.status !== 'claimed' ||
          request.claimedBy !== this.options.agent ||
          !(Date.now() - Date.parse(request.claimedAt ?? '') < 120000)
        )
          throw new ReviewError('Only the agent holding this claim may report failure');
        return { ...f, rewriteRequest: { ...request, status: 'failed', error: reason } };
      },
      'rewrite.failed',
    );
    return { finding };
  }
  async claim(reviewId: string, findingId: string) {
    return { finding: await claim(this.store, reviewId, findingId, this.options.agent ?? 'agent') };
  }
  async decisions(reviewId: string, since?: string) {
    const snapshot = await this.store.read(reviewId);
    return { decisions: await this.store.decisions(snapshot, since) };
  }
  async review(file: string, signal?: AbortSignal) {
    // proofmarks_list_reviews shows sources relative to the project; the document root is the older form.
    const source = await this.store
      .document(path.resolve(this.store.projectBase, file))
      .catch(() => this.store.document(file));
    const review = await reviewFile(source, this.options.provider, {
      root: this.store.root,
      cacheDir: this.options.cacheDir,
      signal,
    });
    const snapshot = await this.store.capture(source);
    return { reviewId: snapshot.reviewId, revision: snapshot.revision, review };
  }
}
