// Invented master data for the browser tests: what core's master_data views would list.
import type { FakeMaster } from '../test/helpers.js';

const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
export function seedMasterData(m: FakeMaster) {
  m.materials_.push(
    // The API itself (a material, so MMS can stock its lots); a blend weighs its released lots.
    { ...item('mat-api', 'API-001', 'Examplone hydrochloride'), category: 'API', unit: 'kg' },
    { ...item('mat-ksm', 'MAT-001', 'Examplol acid'), category: 'starting material', unit: 'kg' },
    { ...item('mat-tol', 'MAT-005', 'Toluene'), category: 'solvent', unit: 'L' },
    { ...item('mat-lbl', 'PM-101', 'Drum label'), category: 'packing material', unit: 'nos' },
  );
  m.equipment_.push(
    { ...item('eq-bal', 'BAL-01', 'Balance 300 kg'), kind: 'instrument', type: 'balance', room: 'DSP-01' },
    { ...item('eq-bln', 'BLN-01', 'Bin blender 1000 L'), kind: 'equipment', type: 'blender', room: 'BLN-01' },
    { ...item('eq-rct', 'RCT-01', 'Glass lined reactor 2000 L'), kind: 'equipment', type: 'reactor', room: 'RXN-01' },
  );
  // These rooms only, not the fixtures' rooms of the server tests.
  m.rooms_.splice(0);
  m.rooms_.push(
    { ...item('rm-dsp', 'DSP-01', 'Dispensing booth 1'), area: 'Dispensing', grade: 'D' },
    { ...item('rm-bln', 'BLN-01', 'Blending room 1'), area: 'Blending', grade: 'D' },
    { ...item('rm-rxn', 'RXN-01', 'Reaction bay 1'), area: 'Reaction', grade: 'D' },
    { ...item('rm-pck', 'PCK-01', 'Packing room 1'), area: 'Packing', grade: 'D' },
  );
}
