import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { dispensingRooms, emptyNote, machineRefusal, untypedNote } from '../shared/engine/picks.js';
import { SKELETON_LIST, skeletonStages } from '../web/src/designer/skeletons.js';

// Equipment and instrument types of an API plant's master data, with a few real types that share a word with them and
// must not be offered (filter press, air compressor, QC balances).
const TYPES = ['Balance', 'Analytical balance', 'Micro balance', 'IPC balance', 'Platform balance', 'Bin blender', 'Glass lined reactor', 'Stainless steel reactor',
  'Centrifuge', 'Agitated nutsche filter dryer', 'Vacuum tray dryer', 'Fluid bed dryer', 'Multimill', 'Micronizer', 'Sifter', 'Filter press', 'Air compressor', 'Manufacturing vessel'];
const MACHINES = TYPES.map((type, i) => ({ code: `EQ-${i}`, type, room: null }));
const BALANCES = ['Balance', 'IPC balance', 'Platform balance'];
const REACTORS = ['Glass lined reactor', 'Stainless steel reactor', 'Manufacturing vessel'];
const OFFERS: Record<string, string[]> = {
  'weigh.balance': BALANCES, 'container-fill.balance': BALANCES,
  'charge.machine': ['Bin blender', ...REACTORS], 'mix.machine': ['Bin blender', ...REACTORS],
  'charge-liquid.machine': REACTORS, 'react.machine': REACTORS, 'separate.machine': REACTORS, 'distil.machine': REACTORS,
  'isolate.machine': ['Centrifuge', 'Agitated nutsche filter dryer'], 'filter-keep.machine': ['Agitated nutsche filter dryer', 'Filter press'],
  'dry.machine': ['Agitated nutsche filter dryer', 'Vacuum tray dryer', 'Fluid bed dryer'], 'sieve.machine': ['Multimill', 'Micronizer', 'Sifter'],
};

describe('machine pickers on the demo master-data types', () => {
  const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100.0', retestMonths: 36 };
  // The types alone: here every stage allows any room (the rooms are tested below).
  const stages = [...SKELETON_LIST.flatMap((s) => skeletonStages(s.id, header))].map((s) => ({ ...s, roomTypes: [] }));

  it('TA-11 every machine field of the skeletons offers the machines of its kind, never a QC lab balance', () => {
    const seen = new Set<string>();
    for (const stage of stages) for (const st of stage.steps) {
      for (const f of findBlock(st.block)!.fields.filter((x) => x.kind === 'machine')) {
        const key = `${st.block.id}.${f.name}`;
        seen.add(key);
        expect([key, MACHINES.filter((m) => !machineRefusal(stage, f, m, [])).map((m) => m.type)]).toEqual([key, OFFERS[key]]);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(OFFERS).sort());
  });

  it('TA-11 an analytical balance is refused on the floor with the reason', () => {
    const stage = stages[0]!;
    const balance = findBlock({ id: 'weigh', version: 1 })!.fields.find((f) => f.name === 'balance')!;
    expect(machineRefusal(stage, balance, { code: 'QC-BAL-1', type: 'Analytical balance', room: null }, [])).toBe('QC-BAL-1 is not a balance (master data: Analytical balance)');
  });

  // The demo's rooms and balances (master data, 15 Nov 2026): IN-BAL-03/04 stand in RM-101 (Dispensing), IN-BAL-05 in
  // RM-105 (Step 2: salt formation), IN-BAL-01/02/06 in RM-110 (QC), INQ-BAL-07 in RM-601 (Microbiology), and the liquids block's
  // INL-BAL-01 in RM-301 (Liquid dispensing).
  const ROOMS = [{ code: 'RM-101', area: 'Dispensing' }, { code: 'RM-103', area: 'Step 1: condensation' }, { code: 'RM-105', area: 'Step 2: salt formation' },
    { code: 'RM-107', area: 'Drying' }, { code: 'RM-108', area: 'Packing' }, { code: 'RM-110', area: 'QC' }, { code: 'RM-601', area: 'Microbiology' },
    { code: 'RM-301', area: 'Liquid dispensing' }];
  const BALS = [['IN-BAL-03', 'RM-101'], ['IN-BAL-04', 'RM-101'], ['IN-BAL-05', 'RM-105'], ['IN-BAL-01', 'RM-110'], ['INQ-BAL-07', 'RM-601'], ['INL-BAL-01', 'RM-301']]
    .map(([code, room]) => ({ code: code!, type: 'Balance', room }));
  const field = (block: string, name: string) => findBlock({ id: block, version: 1 })!.fields.find((f) => f.name === name)!;

  it('TA-11 a balance is offered in the master\'s dispensing rooms, with those of the stage\'s rooms; INL-BAL-01 of the liquids block is not; never a QC or laboratory balance', () => {
    const stage = { ...stages[0]!, roomTypes: ['Step 1: condensation', 'Drying'], machineTypes: ['Granulator', 'Coater'] };
    const offered = (block: string, s = stage, dispensing = ['RM-101']) => BALS.filter((b) => !machineRefusal(s, field(block, 'balance'), b, ROOMS, dispensing)).map((b) => b.code);
    expect(offered('weigh')).toEqual(['IN-BAL-03', 'IN-BAL-04']);
    expect(offered('weigh', { ...stage, roomTypes: ['Step 2: salt formation'] })).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05']);
    expect(offered('weigh', stage, ['RM-301'])).toEqual(['INL-BAL-01']);
    expect(offered('weigh', { ...stage, roomTypes: [] })).toEqual(['IN-BAL-03', 'IN-BAL-04', 'IN-BAL-05', 'INL-BAL-01']);
    expect(machineRefusal(stage, field('weigh', 'balance'), BALS[5]!, ROOMS, ['RM-101'])).toBe('INL-BAL-01 stands in RM-301, neither in a dispensing room of the master nor in a room this stage allows (Step 1: condensation, Drying)');
    expect(machineRefusal(stage, field('weigh', 'balance'), BALS[3]!, ROOMS, ['RM-101'])).toBe('IN-BAL-01 stands in RM-110 (QC), a laboratory area: weigh with a balance of a dispensing room of the master or of a room this stage allows');
    // A version made before the setting: the rooms whose area is exactly "Dispensing".
    const old = { header: { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '1', retestMonths: 12 } };
    expect(dispensingRooms(old, ROOMS)).toEqual(['RM-101']);
    expect(dispensingRooms({ header: { ...old.header, dispensingRooms: ['RM-102'] } }, ROOMS)).toEqual(['RM-102']);
  });

  it('TA-11 an empty machine picker says why: where the machines of its type stand, or that master data has none (17 Nov 2026 run, F17)', () => {
    const stage = { ...stages[0]!, roomTypes: ['RM-105'] };
    const reactor = field('react', 'machine');
    const all = [{ code: 'RCT-01', type: 'Glass lined reactor', room: 'RM-103' }, { code: 'BAL-X', type: null, room: null }, { code: 'CF-01', type: 'Centrifuge', room: 'RM-105' }];
    expect(emptyNote(stage, reactor, all, ROOMS)).toBe('No reactor or vessel can be used here: RCT-01 stands in RM-103, not in a room this stage allows (RM-105). '
      + '1 machine has no type in master data, so it is not offered. Engineering moves one into a room this stage allows, or adds one, in master data (LEAD shows where each stands).');
    expect(emptyNote(stage, reactor, all.slice(1), ROOMS)).toBe('Master data has no active reactor or vessel. 1 machine has no type in master data, so it is not offered. Engineering adds it in master data.');
  });
});
