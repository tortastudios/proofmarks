import { readFile } from 'node:fs/promises';
export type RuleCalibration = {
  threshold: number;
  reviewBand: [number, number];
  repeats: number;
  labeledSetHash?: string;
};
export type Calibration = { rules: Record<string, RuleCalibration>; rulesVersion?: string };
export async function loadCalibration(
  provider: string,
  model: string,
  root = new URL('../../rules/calibration/', import.meta.url),
): Promise<Calibration> {
  if (!/^[a-zA-Z0-9._-]+$/.test(provider) || !/^[a-zA-Z0-9._-]+$/.test(model))
    throw new Error('Invalid calibration identifier');
  const raw = JSON.parse(await readFile(new URL(`${provider}-${model}.json`, root), 'utf8'));
  const rules = raw.rules ?? raw;
  for (const value of Object.values(rules) as (RuleCalibration & { band?: [number, number] })[]) {
    value.reviewBand ??= value.band!;
    if (
      typeof value.threshold !== 'number' ||
      value.threshold < 0 ||
      value.threshold > 1 ||
      !Array.isArray(value.reviewBand) ||
      value.reviewBand.length !== 2 ||
      value.reviewBand.some(n => typeof n !== 'number' || n < 0 || n > 1) ||
      value.reviewBand[0] > value.reviewBand[1] ||
      !Number.isInteger(value.repeats) ||
      value.repeats < 1
    )
      throw new Error('Invalid calibration');
  }
  return { rules, rulesVersion: raw.rulesVersion };
}
export function average(values: number[]): number {
  if (!values.length || values.some(n => !Number.isFinite(n) || n < 0 || n > 1))
    throw new Error('Invalid probabilities');
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
export function calibrate(values: number[], rule?: RuleCalibration) {
  const probability = average(values);
  return {
    probability,
    threshold: rule?.threshold,
    decision: !rule
      ? 'review'
      : probability >= rule.reviewBand[0] && probability <= rule.reviewBand[1]
        ? 'review'
        : probability >= rule.threshold
          ? 'flag'
          : 'clear',
  };
}
