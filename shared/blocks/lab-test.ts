import type { Block } from './format.js';

// An in-process test done in the QC lab (Tablets round 42; owner: in-process lab tests are picked from LIMS, not
// typed): water by KF, residual solvent, related substances or assay of an intermediate. The step sends a sample to QC
// (its lab request opens when it starts, report.lab_request_v1) and picks the result of the approved in-process report
// from LIMS; typed from the QC report only while LIMS cannot be reached. The result is checked against the master's
// limits (C1). A check measured on the floor (pH, a reading) is the "check" block.
export const labTest: Block = {
  id: 'lab-test', version: 1, name: 'QC lab in-process test', checker: false,
  instruction: 'Take the sample, label it and send it to QC. Pick the result from QLIMS once QC has approved it.',
  fields: [{ name: 'result', label: 'Result', kind: 'number', unit: '$unit', qc: 'in_process' }],
  settings: [
    { name: 'what', label: 'What is tested', kind: 'text' },
    { name: 'unit', label: 'Unit', kind: 'text' },
    { name: 'limit', label: 'Limits', kind: 'limit' },
  ],
  calcs: [{ name: 'resultCheck', label: 'Result against limits', template: 'C1', args: { value: '$result', limit: '$limit' } }],
};
