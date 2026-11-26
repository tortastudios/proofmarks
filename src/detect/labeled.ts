// The frozen labeled set: planted passages, human controls and unlabeled real texts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rulesDir } from './registry';
import type { Doc, Finding, Level } from './types';

export type Plant = { level: Level; rules: string[]; text?: string };
/** `kind` is the passage's format: plain text unless it's Markdown, which bold needs. */
export type PlantedPassage = { id: string; split: 'fit' | 'holdout'; kind?: 'mdx'; text: string; plants: Plant[] };
export type HumanPassage = { id: string; author: string; year: number; source: string; kind?: 'mdx'; text: string };

/** A planted passage or human control as a document to review. */
export const passageDoc = (passage: PlantedPassage | HumanPassage): Doc => ({
  id: passage.id,
  kind: passage.kind ?? 'text',
  source: passage.text,
});

export const LABELED_FILES = [
  'planted.json',
  'human.json',
  'real/18f-the-best-way-to-build-big-is-to-start-small.md',
  'real/no-bs-guide-ai-assisted-development.txt',
] as const;
const labeledDir = new URL('labeled/', rulesDir);

/** SHA-256 over every file in the set, in a fixed order; recorded in MANIFEST.json and in each calibration file. */
export function labeledSetHash(dir = labeledDir) {
  const hash = createHash('sha256');
  for (const name of LABELED_FILES)
    hash
      .update(name)
      .update('\0')
      .update(readFileSync(new URL(name, dir)))
      .update('\0');
  return hash.digest('hex');
}

export function labeledSet(dir = labeledDir) {
  const read = (name: string) => readFileSync(new URL(name, dir), 'utf8');
  const planted = (JSON.parse(read('planted.json')) as { passages: PlantedPassage[] }).passages;
  const human = (JSON.parse(read('human.json')) as { passages: HumanPassage[] }).passages;
  const real: Doc[] = [
    {
      id: '18f-the-best-way-to-build-big-is-to-start-small',
      kind: 'mdx',
      source: read('real/18f-the-best-way-to-build-big-is-to-start-small.md'),
    },
    {
      id: 'no-bs-guide-ai-assisted-development',
      kind: 'text',
      source: read('real/no-bs-guide-ai-assisted-development.txt'),
    },
  ];
  return { planted, human, real, hash: labeledSetHash(dir) };
}

/** A plant is caught when a finding under one of its accepted rules covers it (paragraph plants: any paragraph finding). */
export function plantCaught(
  passage: PlantedPassage,
  plant: Plant,
  findings: Pick<Finding, 'rule' | 'level' | 'span'>[],
  anyRule = false,
) {
  const ok = (f: Pick<Finding, 'rule'>) => anyRule || plant.rules.includes(f.rule);
  if (!plant.text) return findings.some(f => f.level === 'paragraph' && ok(f));
  const start = passage.text.indexOf(plant.text),
    end = start + plant.text.length;
  if (start < 0) throw new Error(`Plant "${plant.text}" is not in ${passage.id}.`);
  return findings.some(f => ok(f) && f.span.start < end && f.span.end > start);
}
