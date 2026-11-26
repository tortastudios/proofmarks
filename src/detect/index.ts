export { analyze, decide, detect, DEFAULT_THRESHOLDS, PREAMBLE, type AnalyzeOptions } from './detect';
export { assertRegistry, loadCalibration, loadRegistry, registryErrors, rulesDir } from './registry';
export { bodyStart, project, projectMdx, projectText, sentences, sourceSpan } from './segment';
export { compileLexicon, inflect, lexiconHits } from './lexicon';
export { PATTERNS } from './patterns';
export { labeledSet, labeledSetHash, plantCaught } from './labeled';
export { replayJudge, replayKey } from './replay';
export type * from './types';
export type * from './judge-contract';
