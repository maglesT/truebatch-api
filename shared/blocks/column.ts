import type { Block } from './format.js';

// Column purification (owner, 18 Nov 2026, the 7th block): elution in portions, one round per portion until the last:
// its volume, its test against the master's limit (C1), kept (pooled) or rejected. Packing, conditioning and loading
// the column are steps of their own (charge-liquid, check) before it; the column after use is in the last round.
export const column: Block = {
  id: 'column', version: 1, name: 'Elute a column in portions', checker: false, stop: 'lastPortionCheck',
  instruction: 'Elute with the eluent shown and collect the portions. Test each portion; pool the ones within the limit and reject the others.',
  fields: [
    { name: 'machine', label: 'Column', kind: 'machine', types: ['column'] },
    { name: 'lot', label: 'Eluent lot', kind: 'lot' },
    { name: 'volume', label: 'Portion volume', kind: 'number', unit: 'L' },
    { name: 'result', label: 'Portion test result', kind: 'number', unit: '$resultUnit' },
    { name: 'pooled', label: 'Portion', kind: 'choice', options: ['pooled', 'rejected'] },
    { name: 'lastPortion', label: 'This was the last portion', kind: 'yes-no' },
    { name: 'columnAfter', label: 'The column after use goes to', kind: 'choice', options: ['regeneration', 'waste'], optional: true },
  ],
  settings: [
    { name: 'eluent', label: 'Eluent (formula line)', kind: 'material' },
    { name: 'resultUnit', label: 'Test result unit', kind: 'text', options: ['%', 'ppm', 'pH'] },
    { name: 'resultLimit', label: 'Limit for pooling a portion', kind: 'limit' },
  ],
  calcs: [
    { name: 'resultCheck', label: 'Portion test against the limit for pooling', template: 'C1', args: { value: '$result', limit: '$resultLimit' } },
    { name: 'lastPortionCheck', label: 'Last portion', template: 'C4', args: { question: 'Last portion', answers: ['$lastPortion'], expected: ['yes'] } },
  ],
};
