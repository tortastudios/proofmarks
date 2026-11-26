/**
 * Rate limits and the daily spend cap, kept in memory only: nothing here is written to disk or sent anywhere, and a
 * restart forgets it. Counts are per install for a minute and a day, plus totals for the day.
 */
export type LimitConfig = {
  callsPerMinute: number;
  callsPerDay: number;
  dollarsPerInstallPerDay: number;
  dollarsPerDay: number;
  feedbackPerInstallPerDay: number;
  feedbackPerDay: number;
  decisionsPerInstallPerDay: number;
  installsPerAddressPerDay: number;
};
export const defaultLimits: LimitConfig = {
  callsPerMinute: 240,
  callsPerDay: 6000,
  dollarsPerInstallPerDay: 0.5,
  dollarsPerDay: 20,
  feedbackPerInstallPerDay: 20,
  feedbackPerDay: 300,
  decisionsPerInstallPerDay: 2000,
  installsPerAddressPerDay: 50,
};
type Counter = { calls: number; dollars: number; feedback: number; decisions: number };

export class Limits {
  private day = '';
  private minute = '';
  private perMinute = new Map<string, number>();
  private perInstall = new Map<string, Counter>();
  private perAddress = new Map<string, number>();
  totals = { calls: 0, inputTokens: 0, dollars: 0, feedback: 0 };
  private alerted = new Set<string>();
  readonly config: LimitConfig;
  private readonly now: () => number;
  // Plain fields, not constructor parameter properties: Node runs this file by stripping types.
  constructor(config: LimitConfig, now = () => Date.now()) {
    this.config = config;
    this.now = now;
  }

  private roll() {
    const at = new Date(this.now()),
      day = at.toISOString().slice(0, 10),
      minute = at.toISOString().slice(0, 16);
    if (day !== this.day) {
      this.day = day;
      this.perInstall.clear();
      this.perAddress.clear();
      this.alerted.clear();
      this.totals = { calls: 0, inputTokens: 0, dollars: 0, feedback: 0 };
    }
    if (minute !== this.minute) {
      this.minute = minute;
      this.perMinute.clear();
    }
  }
  private counter(id: string) {
    let counter = this.perInstall.get(id);
    if (!counter) {
      counter = { calls: 0, dollars: 0, feedback: 0, decisions: 0 };
      this.perInstall.set(id, counter);
    }
    return counter;
  }

  /** Why a judge call can't go through now, or undefined when it can. */
  checkCall(id: string): string | undefined {
    this.roll();
    if (this.totals.dollars >= this.config.dollarsPerDay) return 'resting';
    const counter = this.counter(id);
    if (
      (this.perMinute.get(id) ?? 0) >= this.config.callsPerMinute ||
      counter.calls >= this.config.callsPerDay ||
      counter.dollars >= this.config.dollarsPerInstallPerDay
    )
      return 'limited';
    return undefined;
  }
  recordCall(id: string, inputTokens: number, dollars: number) {
    this.roll();
    this.perMinute.set(id, (this.perMinute.get(id) ?? 0) + 1);
    const counter = this.counter(id);
    counter.calls++;
    counter.dollars += dollars;
    this.totals.calls++;
    this.totals.inputTokens += inputTokens;
    this.totals.dollars += dollars;
  }
  checkFeedback(id: string) {
    this.roll();
    return (
      this.counter(id).feedback < this.config.feedbackPerInstallPerDay &&
      this.totals.feedback < this.config.feedbackPerDay
    );
  }
  recordFeedback(id: string) {
    this.roll();
    this.counter(id).feedback++;
    this.totals.feedback++;
  }
  /** A decision count is taken when this install hasn't sent too many today; it can't swamp the totals. */
  takeDecision(id: string) {
    this.roll();
    const counter = this.counter(id);
    if (counter.decisions >= this.config.decisionsPerInstallPerDay) return false;
    counter.decisions++;
    return true;
  }
  checkInstall(address: string) {
    this.roll();
    const count = this.perAddress.get(address) ?? 0;
    if (count >= this.config.installsPerAddressPerDay) return false;
    this.perAddress.set(address, count + 1);
    return true;
  }
  /** Spend thresholds crossed today (0.8, then 1), each reported once. */
  spendAlerts() {
    this.roll();
    const crossed: number[] = [];
    for (const share of [0.8, 1])
      if (this.totals.dollars >= share * this.config.dollarsPerDay && !this.alerted.has(String(share))) {
        this.alerted.add(String(share));
        crossed.push(share);
      }
    return crossed;
  }
}
