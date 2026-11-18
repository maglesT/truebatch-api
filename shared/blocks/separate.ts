import type { Block } from './format.js';

// Work-up (plan 3b): a phase separation or extraction. The layer kept is the master's (its setting; confirmed, C4), the interface seen clean
// (C4); the layer not kept goes to waste, to solvent recovery (TA-24: its quantity and containers become a
// recovered-solvent lot), back to extraction or is kept for a later step. The settling time is the step's minimum time.
export const separate: Block = {
  id: 'separate', version: 1, name: 'Separate the layers', checker: false,
  instruction: 'Let the layers settle, run off the layer not kept and keep the layer shown. Record where the other layer goes.',
  fields: [
    { name: 'machine', label: 'Reactor or vessel', kind: 'machine', types: ['reactor', 'vessel', 'separator'] },
    { name: 'layerKept', label: 'The layer the master says (upper or lower) kept', kind: 'yes-no' },
    { name: 'interfaceClean', label: 'Interface seen clean, no rag layer carried over', kind: 'yes-no' },
    { name: 'otherTo', label: 'The other layer goes to', kind: 'choice', options: ['waste', 'solvent recovery', 'back-extraction', 'kept for a later step'] },
    { name: 'toRecovery', label: 'Quantity sent to solvent recovery', kind: 'number', unit: 'L', optional: true },
    { name: 'recoveryContainers', label: 'Containers sent to solvent recovery', kind: 'number', unit: 'units', optional: true },
  ],
  settings: [
    { name: 'keptLayer', label: 'Layer to keep', kind: 'text', options: ['upper', 'lower'] },
    { name: 'solvent', label: 'Solvent recovered (formula line)', kind: 'material', optional: true },
  ],
  calcs: [
    { name: 'layerCheck', label: 'Layer kept as the master says', template: 'C4', args: { question: 'Layer kept as the master says', answers: ['$layerKept'], expected: ['yes'] } },
    { name: 'interfaceCheck', label: 'Interface clean', template: 'C4', args: { question: 'Interface seen clean', answers: ['$interfaceClean'], expected: ['yes'] } },
  ],
};
