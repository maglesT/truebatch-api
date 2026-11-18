import type { Block } from './format.js';

// Pack and label (plan 3b, TA-26): one round per container until the last: tare, gross, net (T1) within ± tolerance
// of the nominal fill (C1), the liner and the seal number, and the label checked against the record (product, batch
// number, date of manufacture, retest date, storage) by a second person.
export const containerFill: Block = {
  id: 'container-fill', version: 1, name: 'Fill and label a container', checker: true, stop: 'lastContainerCheck',
  instruction: 'Weigh the empty container with its liner, fill it, weigh it, tie the liner, seal the container and fix the label. Check the label against the record.',
  fields: [
    { name: 'balance', label: 'Balance', kind: 'machine', types: ['balance'], notTypes: ['analytical', 'micro'] },
    { name: 'tare', label: 'Tare (container and liner)', kind: 'number', unit: 'kg' },
    { name: 'gross', label: 'Gross weight', kind: 'number', unit: 'kg' },
    { name: 'seal', label: 'Seal number', kind: 'text' },
    { name: 'labelChecked', label: 'Label: product, batch number, date of manufacture, retest date and storage as in the record', kind: 'yes-no' },
    { name: 'lastContainer', label: 'This was the last container', kind: 'yes-no' },
  ],
  settings: [
    { name: 'nominal', label: 'Nominal fill per container', kind: 'quantity' },
    { name: 'tolerance', label: 'Fill tolerance (± %)', kind: 'number' },
  ],
  calcs: [
    { name: 'net', label: 'Net weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'netCheck', label: 'Net against the nominal fill', template: 'C1', args: { value: '$net', around: { centre: '$nominal', name: 'nominal fill', plusMinusPercent: '$tolerance' } } },
    { name: 'labelCheck', label: 'Label checked', template: 'C4', args: { question: 'Label as in the record', answers: ['$labelChecked'], expected: ['yes'] } },
    { name: 'lastContainerCheck', label: 'Last container', template: 'C4', args: { question: 'Last container', answers: ['$lastContainer'], expected: ['yes'] } },
  ],
};
