import type { Block } from './format.js';

// Process to an end point (plan 3b): a reaction, quench, pH adjustment, hydrogenation, crystallisation (cool to, seed,
// hold), heating to reflux, ageing. Periodic rounds at the master's interval with the readings it sets limits for
// (temperature always; pressure and pH when the master sets their limits); an in-process control (IPC) result with its
// report number in the rounds it is taken. The rounds stop when the IPC is within its limit (TA-14: a round "not
// complete, continue" is normal processing); for a TLC or visual end point the master makes "End point seen" the stop.
export const react: Block = {
  id: 'react', version: 1, name: 'Process to an end point', checker: false, stop: 'ipcCheck',
  periodic: { maxMinutes: 480 },
  instruction: 'Record the readings at each interval. When the IPC sample is tested, record its result and report number; go on until the end point is reached.',
  fields: [
    { name: 'machine', label: 'Reactor or vessel', kind: 'machine', types: ['reactor', 'vessel', 'crystalli', 'hydrogenat', 'autoclave'] },
    { name: 'temperature', label: 'Temperature', kind: 'number', unit: '°C' },
    { name: 'pressure', label: 'Pressure (bar, gauge or absolute as the master says)', kind: 'number', unit: 'bar', optional: true },
    { name: 'ph', label: 'pH', kind: 'number', unit: 'pH', optional: true },
    { name: 'ipcMethod', label: 'IPC method', kind: 'choice', options: ['HPLC', 'GC', 'TLC', 'pH', 'KF', 'NMR', 'visual', 'other'], optional: true },
    { name: 'ipcResult', label: 'IPC result', kind: 'number', unit: '$ipcUnit', optional: true },
    { name: 'ipcReport', label: 'IPC report number', kind: 'text', optional: true },
    { name: 'endPointSeen', label: 'End point seen (TLC or visual)', kind: 'yes-no', optional: true },
  ],
  settings: [
    { name: 'temperatureLimit', label: 'Temperature limits', kind: 'limit' },
    { name: 'pressureBasis', label: 'Pressure read as', kind: 'text', options: ['gauge (bar g)', 'absolute (bar a)'], optional: true },
    { name: 'pressureLimit', label: 'Pressure limits', kind: 'limit', optional: true },
    { name: 'phLimit', label: 'pH limits', kind: 'limit', optional: true },
    { name: 'ipcUnit', label: 'IPC result unit', kind: 'text', options: ['%', 'ppm', 'pH'], optional: true },
    { name: 'ipcLimit', label: 'IPC limit (end point)', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'temperatureCheck', label: 'Temperature against limits', template: 'C1', args: { value: '$temperature', limit: '$temperatureLimit' } },
    { name: 'pressureCheck', label: 'Pressure against limits', template: 'C1', args: { value: '$pressure?', limit: '$pressureLimit?' } },
    { name: 'phCheck', label: 'pH against limits', template: 'C1', args: { value: '$ph?', limit: '$phLimit?' } },
    { name: 'ipcCheck', label: 'IPC against the end point', template: 'C1', args: { value: '$ipcResult?', limit: '$ipcLimit?' } },
    { name: 'endPoint', label: 'End point seen', template: 'C4', args: { question: 'End point seen', answers: ['$endPointSeen'], expected: ['yes'] } },
  ],
};
