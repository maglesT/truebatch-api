import type { Block } from './format.js';

// Charge a liquid (plan 3b): a solvent, reagent, acid or base from a released lot, measured by flowmeter, level or
// weight in the unit of its target (the formula line's quantity: per batch, per kg of the key input, or by
// equivalents as a volume through its density, T28), within ± tolerance (C1); always checked by a second person
// (TA-08). An addition time (T13 from its start to its end) and the highest temperature during the addition where the
// master gives their limits.
export const chargeLiquid: Block = {
  id: 'charge-liquid', version: 1, name: 'Charge a liquid', gmp: 'charge-in', checker: true, title: 'Charge {material}',
  instruction: 'Charge the liquid shown from a released lot. Read the quantity on the flowmeter, the level gauge or the balance. Record the start and end of the addition when the master gives an addition time.',
  fields: [
    { name: 'lot', label: 'Lot', kind: 'lot' },
    { name: 'machine', label: 'Reactor or vessel', kind: 'machine', types: ['reactor', 'vessel', 'tank'] },
    { name: 'method', label: 'Measured by', kind: 'choice', options: ['flowmeter', 'level gauge', 'weight'] },
    { name: 'charged', label: 'Quantity charged', kind: 'number', unit: '$unit' },
    { name: 'additionStart', label: 'Start of the addition', kind: 'timer', optional: true },
    { name: 'additionEnd', label: 'End of the addition', kind: 'timer', optional: true },
    { name: 'maxTemperature', label: 'Highest temperature during the addition', kind: 'number', unit: '°C', optional: true },
  ],
  settings: [
    { name: 'target', label: 'Target quantity', kind: 'quantity' },
    { name: 'unit', label: 'Unit', kind: 'text', options: ['L', 'kg'] },
    { name: 'tolerance', label: 'Tolerance (± %)', kind: 'number' },
    { name: 'additionTimeLimit', label: 'Addition time limits', kind: 'limit', optional: true },
    { name: 'temperatureLimit', label: 'Temperature limits during the addition', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'chargedCheck', label: 'Quantity charged against target', template: 'C1', args: { value: '$charged', around: { centre: '$target', name: 'target', plusMinusPercent: '$tolerance' } } },
    { name: 'additionTime', label: 'Addition time', template: 'T13', args: { mode: 'duration', start: '$additionStart', end: '$additionEnd', limit: '$additionTimeLimit' } },
    { name: 'temperatureCheck', label: 'Temperature during the addition', template: 'C1', args: { value: '$maxTemperature?', limit: '$temperatureLimit?' } },
  ],
};
