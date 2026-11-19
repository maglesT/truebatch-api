/** The block library: each block is a description file; a new block (or a new version of one) is a new file here. */
import type { Block } from './format.js';
import { charge } from './charge.js';
import { chargeLiquid } from './charge-liquid.js';
import { check } from './check.js';
import { column } from './column.js';
import { containerFill } from './container-fill.js';
import { containerFillLast } from './container-fill-last.js';
import { containerIssue, containerReturn } from './container-issue.js';
import { distil, distilDry } from './distil.js';
import { filterKeep, isolate } from './isolate.js';
import { destruction } from './destruction.js';
import { dryConstant } from './dry-constant.js';
import { dry } from './dry.js';
import { labTest } from './lab-test.js';
import { lineClearance } from './line-clearance.js';
import { mix } from './mix.js';
import { packMaterialIssue } from './pack-material-issue.js';
import { printedReconciliation } from './printed-reconciliation.js';
import { qaSample } from './qa-sample.js';
import { react } from './react.js';
import { separate } from './separate.js';
import { sieveAnalysis } from './sieve-analysis.js';
import { sieve } from './sieve.js';
import { stageYield } from './stage-yield.js';
import { subBatchCombine } from './sub-batch-combine.js';
import { weigh } from './weigh.js';

export type { Block, BlockField, BlockSetting } from './format.js';
// In the order of a process: dispensing and charging, processing, isolation and drying, milling, checks and yield,
// then Pack and label.
export const BLOCKS: readonly Block[] = [
  weigh, charge, chargeLiquid, mix, react, separate, distil, distilDry, filterKeep, column, isolate, dry, dryConstant, sieve, sieveAnalysis,
  subBatchCombine, check, labTest, qaSample, stageYield, lineClearance,
  containerIssue, packMaterialIssue, containerFill, containerFillLast, containerReturn, printedReconciliation, destruction,
];
export function findBlock(ref: { id: string; version: number }): Block | undefined {
  return BLOCKS.find((b) => b.id === ref.id && b.version === ref.version);
}
