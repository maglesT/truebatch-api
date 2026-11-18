import type { Block } from './format.js';

// Pack and label (TA-26): drums, bags or liners issued by count from a released MMS lot of the material the step
// names (as TrueBatch Injectables' container issue, version 3, owner 17 Nov 2026), and what is left at the end
// counted back in its own step, so the signed issue is never re-opened; material_use_v1 gives MMS the count issued less
// the count back.
export const containerIssue: Block = {
  id: 'container-issue', version: 1, name: 'Issue containers', checker: true, title: 'Issue {material}',
  instruction: 'Issue the containers, liners or bags shown from a released lot of them and count them. What is left at the end is counted back in its own step.',
  fields: [
    { name: 'lot', label: 'Lot', kind: 'lot' },
    { name: 'issued', label: 'Count issued', kind: 'number', unit: 'units' },
  ],
  settings: [
    { name: 'material', label: 'Container, liner or bag', kind: 'material' },
    { name: 'expected', label: 'Count expected', kind: 'quantity' },
    { name: 'enoughLimit', label: 'Count issued, in % of the count expected', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'enough', label: 'Count issued against the count expected', template: 'T3', args: { actual: '$issued', theoretical: '$expected', limit: '$enoughLimit?' } },
  ],
};

export const containerReturn: Block = {
  id: 'container-return', version: 1, name: 'Count back containers', checker: true, title: 'Count back {material}',
  instruction: 'At the end, count the containers, liners or bags of this material left unused and send them back to stores. Give 0 if none are left.',
  fields: [{ name: 'returned', label: 'Count returned to stores', kind: 'number', unit: 'units' }],
  settings: [{ name: 'material', label: 'Container, liner or bag', kind: 'material' }],
  calcs: [],
};
