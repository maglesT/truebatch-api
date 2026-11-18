import type { Block } from './format.js';

// Isolation (plan 3b): centrifuge or filter in loads, one round per load until the last: the slurry charged, the
// wash (its quantity against the master's, C1, from the wash solvent's formula line), the wet cake (gross − tare, T1) and the total of the loads so far (T2),
// the filter cloth checked (C4) and where the mother liquor goes (to solvent recovery: TA-24). A filtration that
// keeps the filtrate (catalyst or carbon removed) has other fields: its own block (owner, 18 Nov 2026).
export const isolate: Block = {
  id: 'isolate', version: 1, name: 'Isolate in loads', checker: false, stop: 'lastLoadCheck',
  instruction: 'For each load: charge the slurry, wash with the solvent shown, spin or suck dry, unload and weigh the wet cake. Record where the mother liquor goes.',
  fields: [
    { name: 'machine', label: 'Centrifuge or filter', kind: 'machine', types: ['centrifuge', 'filter', 'nutsche', 'anfd'], notTypes: ['press'] },
    { name: 'clothChecked', label: 'Filter cloth or bag intact and of the right type', kind: 'yes-no' },
    { name: 'lot', label: 'Wash solvent lot', kind: 'lot', optional: true },
    { name: 'wash', label: 'Wash quantity', kind: 'number', unit: 'L', optional: true },
    { name: 'gross', label: 'Wet cake gross weight', kind: 'number', unit: 'kg' },
    { name: 'tare', label: 'Container tare weight', kind: 'number', unit: 'kg' },
    { name: 'liquorTo', label: 'Mother liquor goes to', kind: 'choice', options: ['waste', 'solvent recovery', 'second crop', 'next step'] },
    { name: 'toRecovery', label: 'Mother liquor sent to solvent recovery', kind: 'number', unit: 'L', optional: true },
    { name: 'recoveryContainers', label: 'Containers sent to solvent recovery', kind: 'number', unit: 'units', optional: true },
    { name: 'lastLoad', label: 'This was the last load', kind: 'yes-no' },
  ],
  settings: [
    { name: 'washTarget', label: 'Wash quantity per load', kind: 'quantity', optional: true },
    { name: 'tolerance', label: 'Wash tolerance (± %)', kind: 'number', optional: true },
    { name: 'solvent', label: 'Solvent recovered (formula line)', kind: 'material', optional: true },
  ],
  calcs: [
    { name: 'clothCheck', label: 'Filter cloth checked', template: 'C4', args: { question: 'Filter cloth intact', answers: ['$clothChecked'], expected: ['yes'] } },
    { name: 'washCheck', label: 'Wash quantity against the master', template: 'C1', args: { value: '$wash', around: { centre: '$washTarget', name: 'wash per load', plusMinusPercent: '$tolerance' } } },
    { name: 'wetCake', label: 'Wet cake', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'totalWetCake', label: 'Total wet cake', template: 'T2', args: { values: ['$prev.totalWetCake?', '$wetCake'], unit: 'kg' } },
    { name: 'lastLoadCheck', label: 'Last load', template: 'C4', args: { question: 'Last load', answers: ['$lastLoad'], expected: ['yes'] } },
  ],
};

// A filtration that keeps the filtrate: catalyst, carbon or a scavenged solid filtered off, the filtrate clear (C4).
export const filterKeep: Block = {
  id: 'filter-keep', version: 1, name: 'Filter, keep the filtrate', checker: false,
  instruction: 'Filter the batch through the filter shown, wash the solid as the master says and keep the filtrate. Record where the solid goes.',
  fields: [
    { name: 'machine', label: 'Filter', kind: 'machine', types: ['filter', 'nutsche', 'sparkler', 'candle'] },
    { name: 'clothChecked', label: 'Filter cloth or cartridge intact and of the right type', kind: 'yes-no' },
    { name: 'clear', label: 'Filtrate clear, no solid passed', kind: 'yes-no' },
    { name: 'solidTo', label: 'The solid goes to', kind: 'choice', options: ['waste', 'recovery (catalyst or reagent)'] },
  ],
  settings: [],
  calcs: [
    { name: 'clothCheck', label: 'Filter checked', template: 'C4', args: { question: 'Filter intact', answers: ['$clothChecked'], expected: ['yes'] } },
    { name: 'clearCheck', label: 'Filtrate clear', template: 'C4', args: { question: 'Filtrate clear', answers: ['$clear'], expected: ['yes'] } },
  ],
};
