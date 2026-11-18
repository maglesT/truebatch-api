import { describe, expect, it } from 'vitest';
import { masterChecks, plainWords } from '../shared/master/checks.js';
import { placeChecks } from '../shared/master/places.js';
import { masterSchema } from '../shared/master/schema.js';
import { describeMaster } from '../web/src/designer/describe.js';
import { verdictless } from '../web/src/designer/example.js';
import { dispensingRoomChoices, grouped, qtyText, stageRoomChoices, unitsOf } from '../web/src/designer/model.js';
import { SKELETON_LIST, skeletonStages } from '../web/src/designer/skeletons.js';
import { api } from './engine-fixture.js';

// The designer findings of the full demo run of 17 Nov 2026 (F03-F17, F35, F36): what the master check reports, the
// plain view's words, and the pick lists offered from master data.

const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '50.0', retestMonths: 36, dispensingRooms: ['RM-101'] };
const room = (code: string, name: string, area: string | null, active = true) => ({ itemId: code, code, name, version: 1, active, area, grade: 'D' });
const machine = (code: string, type: string | null, at: string | null, active = true) => ({ itemId: code, code, name: code, version: 1, active, kind: 'instrument' as const, type, room: at });
const MD = {
  rooms: [room('RM-101', 'Dispensing booth', 'Dispensing'), room('RM-932', 'Immunosuppressants block: dispensing', 'Dispensing'), room('RM-105', 'Blending room 1', 'Blending'),
    room('RM-110', 'QC instrument laboratory', 'QC'), room('RM-501', 'Cyclotron vault', 'Cyclotron vault'), room('RM-999', 'Old room', 'Blending', false)],
  equipment: [machine('IN-BAL-03', 'Balance', 'RM-101'), machine('IN-BAL-01', 'Balance', 'RM-110'), machine('BL-01', 'Bin blender', 'RM-110')],
};
const blending = () => masterSchema.parse({ header, formula: [], stages: skeletonStages('blending', header) });

describe('designer findings of the 17 Nov 2026 run', () => {
  it('TA-11 the master check warns when no machine of a step\'s type stands in the rooms its stage allows, and says where it stands (F17)', () => {
    const doc = blending();
    const mi = doc.stages[0]!.steps.findIndex((t) => t.block.id === 'mix');
    const warned = placeChecks(doc, MD).find((p) => p.path === `stages[0].steps[${mi}]`);
    expect(warned).toMatchObject({ level: 'warning', rule: 'TA-11' });
    expect(warned!.message).toBe('No reactor, vessel or mixer stands in a room this stage allows (Blending): BL-01 stands in RM-110. Allow its room in the stage settings, or engineering moves it in master data');
    const moved = { ...MD, equipment: MD.equipment.map((m) => (m.code === 'BL-01' ? { ...m, room: 'RM-105' } : m)) };
    expect(placeChecks(doc, moved).filter((p) => p.path.startsWith('stages[0]'))).toEqual([]);
    // A type master data does not have at all; a balance in a dispensing room of the master is found there.
    expect(placeChecks(doc, { ...MD, equipment: MD.equipment.filter((m) => m.code !== 'BL-01') }).find((p) => p.path === `stages[0].steps[${mi}]`)!.message)
      .toMatch(/^Master data has no reactor, vessel or mixer/);
    const weigh = doc.stages[0]!.steps.findIndex((t) => t.block.id === 'weigh');
    expect(placeChecks(doc, MD).some((p) => p.path === `stages[0].steps[${weigh}]`)).toBe(false);
  });

  it('the master check reports everything the plain view shows as not set; optional settings left empty are left out of the sentences (F12)', () => {
    for (const s of SKELETON_LIST) {
      const doc = masterSchema.parse({ header, formula: [], stages: skeletonStages(s.id, header).map((st, i) => (i === 0 ? { ...st, role: '' } : st)) });
      const problems = masterChecks(doc);
      for (const [si, sec] of describeMaster(doc).filter((x) => x.key.startsWith('stage:')).entries()) {
        for (const [li, line] of sec.lines.entries()) {
          if (!/not set|not chosen|\?/.test(line.text)) continue;
          const path = li === 0 ? `stages[${si}]` : `stages[${si}].steps[${li - 1}]`;
          expect(problems.some((p) => p.path === path || p.path.startsWith(`${path}.`)), `${s.id}: ${line.text}`).toBe(true);
        }
      }
    }
    const doc = blending();
    // A stage without a responsible role is reported.
    expect(masterChecks({ ...doc, stages: doc.stages.map((s, i) => (i === 0 ? { ...s, role: '' } : s)) }).some((p) => p.path === 'stages[0]' && /no responsible role/.test(p.message))).toBe(true);
  });

  it('the plain view gives numbers with their units and plain sentences (F06, F13)', () => {
    const lines = describeMaster(blending()).flatMap((s) => s.lines.map((l) => l.text));
    expect(lines).toContain('Batch size 50.0 kg of API expected.');
    expect(lines.find((l) => l.includes('Produces blended API'))).toMatch(/to be used within 720 hours \(30 days\)\./);
    // A charged material by its name and code, as the floor names it.
    const d = api();
    const text = describeMaster(d).flatMap((s) => s.lines.map((l) => l.text)).find((l) => l.includes('Charge a material'))!;
    expect(text).toContain('Material: Examplol acid (MAT-001).');
    expect(text).not.toContain('formula line');
    expect(grouped('600.0 mg × 50000 tablets = 30.000 kg')).toBe('600.0 mg × 50,000 tablets = 30.000 kg');
    expect(grouped('CC-2026-0016, 49225.7 tablets, 100000 tablets')).toBe('CC-2026-0016, 49225.7 tablets, 1,00,000 tablets');
  });

  it('no internal codes of rules, templates or failure cases in what the master check says (F07)', () => {
    expect(plainWords('A line is adjusted for potency (T9) or for content (T18), not both')).toBe('A line is adjusted for potency or for content, not both');
    expect(plainWords('stop at that net weight (F0339: spraying all of it gives about 4.5 % more drug)')).toBe('stop at that net weight (spraying all of it gives about 4.5 % more drug)');
    const d = api();
    d.formula[0]!.adjust = { potency: { basis: 'as is' }, content: { formulaQuantityIs: 'dry' } };
    d.formula[0]!.name = 'Examplol acid wet cake';
    for (const p of masterChecks(d)) expect(p.message).not.toMatch(/\bT\d+\b|\bTB-\w+|\bF0\d{3}\b/);
    // An answer given to the message as it read before keeps counting.
    const wet = masterChecks(d).find((p) => p.question?.key === 'solvent-wet/ksm')!;
    expect(wet.message).toContain('(an assay adjustment on the dried or solvent-free basis, or a content adjustment)');
  });

  it('the worked example gives its verdict once, in the chip (F14)', () => {
    expect(verdictless('All 6 units disintegrated within 15 min: PASS')).toBe('All 6 units disintegrated within 15 min');
    expect(verdictless('6.0 within limits')).toBe('6.0 within limits');
  });

  it('pick lists offer the relevant rooms first, by name (F05, F09)', () => {
    // Dispensing: the rooms with a weighing balance first (never a QC lab's), each by code, name and area.
    const disp = dispensingRoomChoices(MD);
    expect(disp.groups).toEqual([{ label: 'Rooms with a weighing balance', options: ['RM-101'] }, { label: 'Other rooms', options: ['RM-105', 'RM-110', 'RM-501', 'RM-932'] }]);
    expect(disp.text('RM-932')).toBe('RM-932 · Immunosuppressants block: dispensing (Dispensing)');
    // A stage: the areas and rooms where its machines stand first.
    const st = stageRoomChoices(blending().stages[0]!, MD);
    expect(st.groups[0]).toEqual({ label: "Where this stage's machines stand", options: ['QC', 'RM-110'] });
    expect(st.groups[1]!.options).toEqual(['Blending', 'Cyclotron vault', 'Dispensing']);
  });

  it('a small quantity reads in g; the unit lists offer every unit of the unit table (ported from TrueBatch API)', () => {
    expect(qtyText({ ok: true, value: '0.0025', unit: 'kg', shown: '' })).toBe('2.500 g');
    expect(qtyText({ ok: true, value: '1.2625', unit: 'kg', shown: '' })).toBe('1.263 kg');
    expect(qtyText({ ok: false, message: 'x' })).toBe('—');
    expect(unitsOf('temperature').map((u) => u.symbol)).toEqual(['°C', 'K', '°F']);
    expect(unitsOf('pressure').map((u) => u.symbol)).toContain('N/mm²');
  });
});
