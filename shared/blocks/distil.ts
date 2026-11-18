import type { Block } from './format.js';

// Distillation, concentration or solvent swap (plan 3b): readings at the master's interval (pot temperature, vacuum)
// until the end point. Two end points, one block each (owner, 18 Nov 2026: a setting never changes the required
// fields): the volume left in the vessel within the master's limit (distil), or distilled to dryness (distil-dry).
// The distillate's destination is recorded in the last round; to solvent recovery its quantity and containers become
// a recovered-solvent lot (TA-24).
const RECOVERY = [
  { name: 'distillateTo', label: 'Distillate goes to', kind: 'choice' as const, options: ['waste', 'solvent recovery'], optional: true },
  { name: 'toRecovery', label: 'Distillate sent to solvent recovery', kind: 'number' as const, unit: 'L', optional: true },
  { name: 'recoveryContainers', label: 'Containers sent to solvent recovery', kind: 'number' as const, unit: 'units', optional: true },
];
const READINGS = [
  { name: 'machine', label: 'Reactor or vessel', kind: 'machine' as const, types: ['reactor', 'vessel', 'evaporator', 'distillation'] },
  { name: 'temperature', label: 'Pot temperature', kind: 'number' as const, unit: '°C' },
  { name: 'vacuum', label: 'Vacuum', kind: 'number' as const, unit: 'mbar', optional: true },
];
const SETTINGS = [
  { name: 'temperatureLimit', label: 'Pot temperature limits', kind: 'limit' as const },
  { name: 'vacuumLimit', label: 'Vacuum limits', kind: 'limit' as const, optional: true },
  { name: 'solvent', label: 'Solvent recovered (formula line)', kind: 'material' as const, optional: true },
];
const CHECKS = [
  { name: 'temperatureCheck', label: 'Pot temperature against limits', template: 'C1', args: { value: '$temperature', limit: '$temperatureLimit' } },
  { name: 'vacuumCheck', label: 'Vacuum against limits', template: 'C1', args: { value: '$vacuum?', limit: '$vacuumLimit?' } },
];

export const distil: Block = {
  id: 'distil', version: 1, name: 'Distil to a volume', checker: false, stop: 'endPoint', periodic: { maxMinutes: 480 },
  instruction: 'Distil under the conditions shown. At each interval record the readings and the volume left; stop at the end point and record where the distillate goes.',
  fields: [...READINGS, { name: 'volumeLeft', label: 'Volume left in the vessel', kind: 'number', unit: 'L' }, ...RECOVERY],
  settings: [...SETTINGS, { name: 'volumeLimit', label: 'Volume left at the end point', kind: 'limit' }],
  calcs: [...CHECKS, { name: 'endPoint', label: 'Volume left against the end point', template: 'C1', args: { value: '$volumeLeft', limit: '$volumeLimit' } }],
};

export const distilDry: Block = {
  id: 'distil-dry', version: 1, name: 'Distil to dryness', checker: false, stop: 'endPoint', periodic: { maxMinutes: 480 },
  instruction: 'Distil under the conditions shown until nothing more distils. At each interval record the readings; at the end record where the distillate goes.',
  fields: [...READINGS, { name: 'dry', label: 'Distilled to dryness (nothing more distils)', kind: 'yes-no' }, ...RECOVERY],
  settings: SETTINGS,
  calcs: [...CHECKS, { name: 'endPoint', label: 'Distilled to dryness', template: 'C4', args: { question: 'Distilled to dryness', answers: ['$dry'], expected: ['yes'] } }],
};
