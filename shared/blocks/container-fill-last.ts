import type { Block } from './format.js';

// Pack and label (owner, 19 Nov 2026): the last container may be part-filled. It follows the Fill and label step (whose
// rounds then fill the full containers) and takes the rest of the batch: its net (T1) is checked against a minimum
// fill the master sets, in kg (C1) or in % of the nominal fill (T3), not against the nominal fill. A QA hold: QA checks
// the container and releases it on the step. Below the minimum it is out of limits and raises a deviation as before.
export const containerFillLast: Block = {
  id: 'container-fill-last', version: 1, name: 'Fill and label the last container (may be part-filled)', checker: true, qaHold: true,
  instruction: 'Fill the rest of the batch into the last container: weigh it empty with its liner, fill it, weigh it, tie the liner, seal it and fix the label. Check the label against the record. Wait for QA to check the container and release the hold.',
  fields: [
    { name: 'balance', label: 'Balance', kind: 'machine', types: ['balance'], notTypes: ['analytical', 'micro'] },
    { name: 'tare', label: 'Tare (container and liner)', kind: 'number', unit: 'kg' },
    { name: 'gross', label: 'Gross weight', kind: 'number', unit: 'kg' },
    { name: 'seal', label: 'Seal number', kind: 'text' },
    { name: 'labelChecked', label: 'Label: product, batch number, date of manufacture, retest date and storage as in the record', kind: 'yes-no' },
  ],
  settings: [
    { name: 'nominal', label: 'Nominal fill per container', kind: 'quantity' },
    // One of the two (the master check asks for exactly one): the minimum in kg, or in % of the nominal fill.
    { name: 'minimumFill', label: 'Minimum fill of the last container (kg)', kind: 'limit', optional: true },
    { name: 'minimumPercent', label: 'Minimum fill of the last container (% of the nominal fill)', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'net', label: 'Net weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'netCheck', label: 'Net against the minimum fill', template: 'C1', args: { value: '$net', limit: '$minimumFill?' } },
    { name: 'fillPercent', label: 'Fill as % of the nominal fill', template: 'T3', args: { actual: '$net', theoretical: '$nominal', limit: '$minimumPercent?' } },
    { name: 'labelCheck', label: 'Label checked', template: 'C4', args: { question: 'Label as in the record', answers: ['$labelChecked'], expected: ['yes'] } },
  ],
};
