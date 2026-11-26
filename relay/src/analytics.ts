/**
 * Usage counts, sent to PostHog from the server, only for installs that turned them on: one event when such
 * an install gets its token (version, route, OS and, when the listing said, the listing it came from), hourly totals of
 * their judge calls, and hourly totals of what they did with marks (per rule, action, score and line; see Decision).
 * Never any text, URL, file name or token, and decisions aren't tied to an install. No event has a person profile or a
 * location.
 */
export type Event = {
  event: string;
  distinct_id: string;
  properties: Record<string, string | number | boolean>;
  timestamp: string;
};

/** A person's call on a mark: the rule, what they did, Jev's score rounded down to 0.05 and the line it was shown under. */
export type Decision = {
  rule: string;
  action: 'kept' | 'dismissed' | 'undone' | 'restored';
  score: number;
  line: number;
  model: string;
  rulesVersion: string;
};

/** On every event: no person profile, and no location looked up from the sender's address. */
const PRIVATE = { $process_person_profile: false, $geoip_disable: true } as const;

export class Analytics {
  private queue: Event[] = [];
  private decisions = new Map<string, { decision: Decision; count: number }>();
  private hour = { calls: 0, inputTokens: 0, dollars: 0, installs: new Set<string>() };
  private readonly config: { apiKey?: string; host: string };
  private readonly request: typeof fetch;
  private readonly now: () => number;
  constructor(config: { apiKey?: string; host: string }, request: typeof fetch = fetch, now = () => Date.now()) {
    this.config = config;
    this.request = request;
    this.now = now;
  }

  get enabled() {
    return !!this.config.apiKey;
  }
  install(distinctId: string, properties: { version: string; route: string; os: string; via?: string }) {
    if (!this.enabled) return;
    this.queue.push({
      event: 'proofmarks install',
      distinct_id: distinctId,
      properties: { ...properties, ...PRIVATE },
      timestamp: new Date(this.now()).toISOString(),
    });
  }
  call(distinctId: string, inputTokens: number, dollars: number) {
    this.hour.calls++;
    this.hour.inputTokens += inputTokens;
    this.hour.dollars += dollars;
    this.hour.installs.add(distinctId);
  }
  decision(decision: Decision) {
    const key = JSON.stringify(decision);
    const entry = this.decisions.get(key) ?? { decision, count: 0 };
    entry.count++;
    this.decisions.set(key, entry);
  }
  feedback(kind: string) {
    if (!this.enabled) return;
    this.queue.push({
      event: 'proofmarks feedback',
      distinct_id: 'proofmarks-relay',
      properties: { kind, ...PRIVATE },
      timestamp: new Date(this.now()).toISOString(),
    });
  }
  /** Sends what's queued plus this hour's totals, then starts the next hour. Failures are dropped, never retried with data. */
  async flush() {
    if (this.hour.calls) {
      this.queue.push({
        event: 'proofmarks judge usage',
        distinct_id: 'proofmarks-relay',
        properties: {
          calls: this.hour.calls,
          input_tokens: this.hour.inputTokens,
          dollars: Math.round(this.hour.dollars * 1e6) / 1e6,
          active_installs: this.hour.installs.size,
          ...PRIVATE,
        },
        timestamp: new Date(this.now()).toISOString(),
      });
    }
    for (const { decision, count } of this.decisions.values())
      this.queue.push({
        event: 'proofmarks decisions',
        distinct_id: 'proofmarks-relay',
        properties: {
          rule: decision.rule,
          action: decision.action,
          score: decision.score,
          line: decision.line,
          model: decision.model,
          rules_version: decision.rulesVersion,
          count,
          ...PRIVATE,
        },
        timestamp: new Date(this.now()).toISOString(),
      });
    this.decisions.clear();
    this.hour = { calls: 0, inputTokens: 0, dollars: 0, installs: new Set() };
    const batch = this.queue;
    this.queue = [];
    if (!this.enabled || !batch.length) return 0;
    try {
      await this.request(`${this.config.host.replace(/\/$/, '')}/batch/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: this.config.apiKey, batch }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      /* Analytics never get in the way of the relay. */
    }
    return batch.length;
  }
}
