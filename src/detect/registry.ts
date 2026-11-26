// Rule registry validation and loading. The registry is the single source of rule names, explanations and marks.
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bundledRegistry from '../../rules/rules.v3.json';
import { CONTEXTS, DETECTORS, EDITS, LEVELS, MARKS, type Calibration, type Registry, type Rule } from './types';
import { PATTERNS } from './patterns';

// Built from a path, not new URL('../../rules/', import.meta.url), which bundlers try to resolve as one static asset.
export const rulesDir = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../rules') + sep);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] =>
  typeof value === 'string' && list.includes(value);

/** Every problem in a registry, as readable strings; an empty list means valid. */
export function registryErrors(input: unknown) {
  const errors: string[] = [];
  const registry = input as Partial<Registry> | null;
  if (!registry || typeof registry !== 'object') return ['Registry must be an object.'];
  if (registry.version !== '3') errors.push('version must be "3".');
  if (!Array.isArray(registry.rules) || !registry.rules.length) return [...errors, 'rules must be a non-empty array.'];
  const ids = new Set<string>();
  for (const [index, raw] of registry.rules.entries()) {
    const rule = raw as Partial<Rule>,
      at = `rules[${index}]${rule?.id ? ` (${rule.id})` : ''}`;
    if (!isText(rule.id) || !/^[a-z][a-z0-9-]*$/.test(rule.id)) errors.push(`${at}: id must be kebab-case.`);
    else if (ids.has(rule.id)) errors.push(`${at}: duplicate id.`);
    else ids.add(rule.id);
    for (const field of ['label', 'why', 'fix'] as const)
      if (!isText(rule[field])) errors.push(`${at}: ${field} is required.`);
    for (const field of ['why', 'fix'] as const)
      if (isText(rule[field]) && (rule[field].length > 90 || /\n/.test(rule[field])))
        errors.push(`${at}: ${field} must be one short line.`);
    if (!oneOf(LEVELS, rule.level)) errors.push(`${at}: level must be one of ${LEVELS.join(', ')}.`);
    if (!oneOf(EDITS, rule.edit)) errors.push(`${at}: edit must be one of ${EDITS.join(', ')}.`);
    if (rule.edit === 'paragraph' && rule.level !== 'paragraph')
      errors.push(`${at}: edit "paragraph" needs level "paragraph".`);
    if (rule.color !== undefined && (typeof rule.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(rule.color)))
      errors.push(`${at}: color must be a six-digit hex ink.`);
    if (rule.mark !== undefined && !oneOf(MARKS, rule.mark))
      errors.push(`${at}: mark must be one of ${MARKS.join(', ')}.`);
    if (typeof rule.default !== 'boolean') errors.push(`${at}: default must be true or false.`);
    if (rule.severity !== undefined && !['flag', 'warning'].includes(rule.severity))
      errors.push(`${at}: severity must be flag or warning.`);
    const detector = rule.detector;
    if (!detector || !oneOf(DETECTORS, detector.kind)) {
      errors.push(`${at}: detector.kind must be one of ${DETECTORS.join(', ')}.`);
      continue;
    }
    if (detector.kind === 'lexicon') {
      if (!Array.isArray(detector.terms) || !detector.terms.length) errors.push(`${at}: lexicon needs terms.`);
      else
        for (const term of detector.terms) {
          if (!isText(term.term)) errors.push(`${at}: every term needs text.`);
          if (term.pos && !['verb', 'noun', 'adj', 'phrase'].includes(term.pos))
            errors.push(`${at}: term "${term.term}" has an unknown pos.`);
        }
    }
    if (detector.kind === 'pattern' && !(detector.pattern in PATTERNS))
      errors.push(`${at}: unknown pattern "${detector.pattern}".`);
    const judge = rule.judge;
    if (detector.kind === 'judge' && !judge) errors.push(`${at}: judge rules need a judge question.`);
    if (detector.kind === 'lexicon' && !judge) errors.push(`${at}: lexicon rules need a veto question.`);
    if (judge) {
      for (const field of ['ask', 'yes', 'no'] as const)
        if (!isText(judge[field])) errors.push(`${at}: judge.${field} is required.`);
      if (!oneOf(CONTEXTS, judge.context)) errors.push(`${at}: judge.context must be one of ${CONTEXTS.join(', ')}.`);
      if (detector.kind === 'lexicon' && isText(judge.ask) && !judge.ask.includes('{term}'))
        errors.push(`${at}: a lexicon veto question must name {term}.`);
    }
  }
  return errors;
}

export function assertRegistry(input: unknown) {
  const errors = registryErrors(input);
  if (errors.length) throw new Error(`Invalid rule registry:\n- ${errors.join('\n- ')}`);
  return input as Registry;
}

export const loadRegistry = (file?: URL) =>
  assertRegistry(file ? JSON.parse(readFileSync(file, 'utf8')) : structuredClone(bundledRegistry));

export function loadCalibration(file: URL) {
  const calibration = JSON.parse(readFileSync(file, 'utf8')) as Calibration;
  for (const [id, rule] of Object.entries(calibration.rules)) {
    if (!(rule.threshold >= 0 && rule.threshold <= 1) || !(rule.repeats >= 1))
      throw new Error(`Invalid calibration for ${id}.`);
  }
  return calibration;
}
