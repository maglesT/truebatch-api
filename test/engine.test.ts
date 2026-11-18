import { describe, expect, it } from 'vitest';
import {
  currentValues, doneProblems, evaluate, openSteps, parseKey, refusal, stepLabel, stepState, stepTitle, timers,
  type Action, type State, type StepEvent,
} from '../shared/engine/index.js';
import { at, ev, fail, pass, reading, small, api } from './engine-fixture.js';
import { lineQuantity } from '../shared/engine/values.js';

const kinds = (s: string) => s.split(' ').filter(Boolean).map((k) => ev(k as StepEvent['kind'], '0.1.0.1'));
const stateOf = (doc: ReturnType<typeof small>, events: StepEvent[], id: string, now = at(1000)) => {
  const v = openSteps(doc, events, now).steps.find((s) => s.id === id);
  return v ? v.state : 'absent';
};

describe('stepState', () => {
  it.each([
    ['', false, 'waiting', false],
    ['started', false, 'in_progress', false],
    ['started value value', false, 'in_progress', false],
    ['started value done', false, 'done', false],
    ['started value done', true, 'done_awaiting_check', false],
    ['started value done checked', true, 'checked', false],
    ['started value done sent_back', true, 'in_progress', false],
    ['started value done sent_back done', true, 'done_awaiting_check', false],
    ['started value done checked corrected', true, 'in_progress', true],
    ['started value done corrected done', true, 'done_awaiting_check', false],
    ['started not_applicable', false, 'not_applicable', false],
    ['started value done note late', false, 'done', false],
  ])('events "%s" (check: %s) → %s, needs re-sign %s', (events, needsCheck, state, resign) => {
    expect(stepState(kinds(events), needsCheck)).toEqual({ state, needsResign: resign });
  });
});

describe('the action table', () => {
  const op = { id: 1, permissions: ['truebatch_api.batch.operate'] };
  const checker = { id: 2, permissions: ['truebatch_api.batch.check'] };
  const qa = { id: 3, permissions: ['truebatch_api.qa.release'] };
  const ctx = (state: State, events: StepEvent[], user = op, flow: 'none' | 'optional-with-reason' | 'qa-hold' = 'none') => ({ state, events, flow, user });
  const ok = (a: Action, c: ReturnType<typeof ctx>) => refusal(a, c)?.error ?? 'allowed';

  it.each<[Action, State, string, typeof op, string]>([
    ['start', 'open', '', op, 'allowed'],
    ['start', 'waiting', '', op, 'wrong_state'],
    ['start', 'open', '', checker, 'forbidden'],
    ['record', 'in_progress', 'started', op, 'allowed'],
    ['record', 'in_progress', 'started value done sent_back', op, 'wrong_state'],
    ['correct', 'in_progress', 'started value done sent_back', op, 'allowed'],
    ['correct', 'in_progress', 'started value', op, 'wrong_state'],
    ['correct', 'checked', 'started value done checked', op, 'allowed'],
    ['done', 'in_progress', 'started value', op, 'allowed'],
    ['done', 'done_awaiting_check', 'started value done', op, 'wrong_state'],
    ['check', 'done_awaiting_check', 'started value done', checker, 'allowed'],
    ['check', 'in_progress', 'started value', checker, 'wrong_state'],
    ['check', 'done_awaiting_check', 'started value done', op, 'forbidden'],
    ['send-back', 'done_awaiting_check', 'started value done', checker, 'allowed'],
    ['note', 'waiting', '', checker, 'allowed'],
    ['note', 'checked', '', qa, 'allowed'],
  ])('%s while %s (events "%s") → %s', (action, state, events, user, want) => {
    expect(ok(action, ctx(state, kinds(events), user))).toBe(want);
  });

  it('TA-08 the checker cannot be the performer, nor anyone who started, recorded or corrected the step', () => {
    const both = { id: 1, permissions: ['truebatch_api.batch.operate', 'truebatch_api.batch.check'] };
    const done = [ev('started', '0.1.0.1', { person: 7 }), ev('value', '0.1.0.1', { person: 1 }), ev('done', '0.1.0.1', { person: 7 })];
    expect(refusal('check', ctx('done_awaiting_check', done, both))?.error).toBe('own_work');
    expect(refusal('send-back', ctx('done_awaiting_check', done, both))?.error).toBe('own_work');
    expect(refusal('check', ctx('done_awaiting_check', done, { ...both, id: 2 }))).toBeNull();
    const corrected = [...done, ev('corrected', '0.1.0.1', { person: 2 }), ev('done', '0.1.0.1', { person: 7 })];
    expect(refusal('check', ctx('done_awaiting_check', corrected, { ...both, id: 2 }))?.error).toBe('own_work');
  });

  it('only an optional step can be not applicable; only a QA-hold step can be released, once', () => {
    expect(refusal('not-applicable', ctx('open', [], op, 'none'))?.error).toBe('wrong_state');
    expect(refusal('not-applicable', ctx('open', [], op, 'optional-with-reason'))).toBeNull();
    const done = kinds('started value done');
    expect(refusal('release-hold', ctx('done', done, qa, 'none'))?.error).toBe('wrong_state');
    expect(refusal('release-hold', ctx('done', done, qa, 'qa-hold'))).toBeNull();
    expect(refusal('release-hold', ctx('done', [...done, ev('qa_released_hold', '0.1.0.1')], qa, 'qa-hold'))?.error).toBe('wrong_state');
    expect(refusal('release-hold', ctx('done', done, op, 'qa-hold'))?.error).toBe('forbidden');
  });

  it('step keys are stage.sub-batch.step.round', () => {
    expect(parseKey('2.1.3.4')).toEqual({ stage: 2, sub: 1, step: 3, round: 4 });
    expect(parseKey('2.0.3.1')).toBeNull();
    expect(parseKey('2.1.3')).toBeNull();
  });
});

describe('openSteps', () => {
  it('TA-09 normal: the next step opens when the previous is done; the next stage when the previous stage is closed', () => {
    const doc = small([{ steps: [{}, {}] }, {}]);
    expect(stateOf(doc, [], '0.1.0.1')).toBe('open');
    expect(stateOf(doc, [], '0.1.1.1')).toBe('waiting');
    expect(stateOf(doc, [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')], '0.1.1.1')).toBe('open');
    const first = [ev('started', '0.1.0.1'), ev('done', '0.1.0.1'), ev('started', '0.1.1.1')];
    expect(stateOf(doc, first, '1.1.0.1')).toBe('waiting');
    expect(stateOf(doc, [...first, ev('done', '0.1.1.1')], '1.1.0.1')).toBe('open');
  });

  it('with a checker the next step opens on done, or only on the check when the master says wait for the check', () => {
    const done = [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')];
    expect(stateOf(small([{ steps: [{ checker: true }, {}] }]), done, '0.1.1.1')).toBe('open');
    expect(stateOf(small([{ steps: [{ checker: true, waitForCheck: true }, {}] }]), done, '0.1.1.1')).toBe('waiting');
    expect(stateOf(small([{ steps: [{ checker: true, waitForCheck: true }, {}] }]), [...done, ev('checked', '0.1.0.1', { person: 2 })], '0.1.1.1')).toBe('open');
  });

  it('a stage is closed only when every check is done', () => {
    const doc = small([{ steps: [{ checker: true }] }, {}]);
    const done = [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')];
    expect(openSteps(doc, done, at(100)).stages[0]!.closed).toBe(false);
    expect(stateOf(doc, done, '1.1.0.1')).toBe('waiting');
    expect(stateOf(doc, [...done, ev('checked', '0.1.0.1', { person: 2 })], '1.1.0.1')).toBe('open');
  });

  it('preparation: opens any time, and must be closed before the stage that uses it', () => {
    const doc = small([{}, { kind: 'preparation', produces: { name: 'binder', holdHours: 24 } }, { uses: ['s1'] }]);
    expect(stateOf(doc, [], '1.1.0.1')).toBe('open');
    const first = [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')];
    expect(stateOf(doc, first, '2.1.0.1')).toBe('waiting');
    expect(openSteps(doc, first, at(100)).stages[2]!.blocked).toBe('Waits for the preparation Stage 1 to close');
    expect(stateOf(doc, [...first, ev('started', '1.1.0.1'), ev('done', '1.1.0.1')], '2.1.0.1')).toBe('open');
  });

  it('repeat-until: a new round opens while the stop check fails, until it passes', () => {
    const doc = small([{ steps: [{ flow: { kind: 'repeat-until', maxRounds: 3, stop: 'readingCheck' } }, {}] }]);
    const r1 = [ev('started', '0.1.0.1'), reading('0.1.0.1', { readingCheck: fail }), ev('done', '0.1.0.1')];
    expect(stateOf(doc, r1, '0.1.0.2')).toBe('open');
    expect(stateOf(doc, r1, '0.1.1.1')).toBe('waiting');
    const r2 = [...r1, ev('started', '0.1.0.2'), reading('0.1.0.2', { readingCheck: pass }), ev('done', '0.1.0.2')];
    expect(stateOf(doc, r2, '0.1.0.3')).toBe('absent');
    expect(stateOf(doc, r2, '0.1.1.1')).toBe('open');
  });

  it('TA-09 repeat-until: after the most rounds without passing, the next step needs a deviation note', () => {
    const doc = small([{ steps: [{ flow: { kind: 'repeat-until', maxRounds: 2, stop: 'readingCheck' } }, {}] }]);
    const round = (r: number) => [ev('started', `0.1.0.${r}`), reading(`0.1.0.${r}`, { readingCheck: fail }), ev('done', `0.1.0.${r}`)];
    const both = [...round(1), ...round(2)];
    expect(stateOf(doc, both, '0.1.0.3')).toBe('absent');
    const v = openSteps(doc, both, at(1000)).steps.find((s) => s.id === '0.1.1.1')!;
    expect(v.state).toBe('waiting');
    expect(v.blocked).toMatch(/did not pass in 2 round\(s\), the most allowed: a deviation note is needed/);
    expect(stateOf(doc, [...both, ev('note', '0.1.0.2', { payload: { text: 'Deviation raised' } })], '0.1.1.1')).toBe('open');
  });

  it('sub-batch: N numbered copies run side by side; the stage closes when all are done', () => {
    const doc = small([{ kind: 'sub-batch', count: 3 }, {}]);
    const ids = openSteps(doc, [], at(0)).steps.map((s) => `${s.id} ${s.state}`);
    expect(ids).toEqual(['0.1.0.1 open', '0.2.0.1 open', '0.3.0.1 open', '1.1.0.1 waiting']);
    const two = ['0.1.0.1', '0.2.0.1'].flatMap((k) => [ev('started', k), ev('done', k)]);
    expect(stateOf(doc, two, '1.1.0.1')).toBe('waiting');
    expect(stateOf(doc, [...two, ev('started', '0.3.0.1'), ev('done', '0.3.0.1')], '1.1.0.1')).toBe('open');
  });

  it('QA hold: the next step waits for QA to release the hold', () => {
    const doc = small([{ steps: [{ flow: { kind: 'qa-hold' } }, {}] }]);
    const done = [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')];
    const v = openSteps(doc, done, at(100)).steps[1]!;
    expect([v.state, v.blocked]).toEqual(['waiting', 'Waits for QA to release the hold on “Check a value against limits: pH”']);
    expect(stateOf(doc, [...done, ev('qa_released_hold', '0.1.0.1', { person: 3 })], '0.1.1.1')).toBe('open');
  });

  it('a step not applicable lets the next step open', () => {
    const doc = small([{ steps: [{ flow: { kind: 'optional-with-reason' } }, {}] }]);
    expect(stateOf(doc, [ev('not_applicable', '0.1.0.1')], '0.1.1.1')).toBe('open');
  });
});

describe('corrections', () => {
  it('TA-06 a correction replaces the value and the original is kept, with the reason', () => {
    const events = [
      ev('started', '0.1.0.1'),
      ev('value', '0.1.0.1', { payload: { values: { reading: { value: '6.1', unit: '' } }, results: { readingCheck: pass as never } } }),
      ev('done', '0.1.0.1'),
      ev('corrected', '0.1.0.1', { person: 4, payload: { values: { reading: { value: '6.2', unit: '' } }, results: { readingCheck: fail as never }, reason: 'typing error' } }),
    ];
    const c = currentValues(events);
    expect(c.values.reading).toEqual({ value: '6.2', unit: '' });
    expect(c.results.readingCheck).toEqual(fail);
    expect(c.replaced).toMatchObject([{ field: 'reading', was: { value: '6.1', unit: '' }, now: { value: '6.2', unit: '' }, reason: 'typing error', person: 4 }]);
  });

  it('a correction after the check takes the step back: it needs re-signing and re-checking, and the stage reopens', () => {
    const doc = small([{ steps: [{ checker: true }] }, {}]);
    const checked = [ev('started', '0.1.0.1'), ev('value', '0.1.0.1'), ev('done', '0.1.0.1'), ev('checked', '0.1.0.1', { person: 2 })];
    const corrected = [...checked, ev('corrected', '0.1.0.1', { payload: { values: {}, reason: 'wrong lot typed' } })];
    const v = openSteps(doc, corrected, at(100)).steps[0]!;
    expect([v.state, v.needsResign]).toEqual(['in_progress', true]);
    expect(openSteps(doc, corrected, at(100)).stages[0]!.closed).toBe(false);
    expect(stateOf(doc, [...corrected, ev('done', '0.1.0.1')], '0.1.0.1')).toBe('done_awaiting_check');
  });
});

describe('done needs', () => {
  const doc = small([{ steps: [{ minMinutes: 10 }] }]);
  const view = (events: StepEvent[], now: Date) => doneProblems(doc, openSteps(doc, events, now).steps[0]!, now);

  it('TA-14 every required field, no refused calculation and no failing check without a deviation note after it', () => {
    expect(view([ev('started', '0.1.0.1', { min: 0 })], at(20))).toEqual(['Reading is not recorded']);
    const refused = ev('value', '0.1.0.1', { min: 1, payload: { values: { reading: { value: '1', unit: '' } }, results: { readingCheck: { ok: false, message: 'bad limit' } } } });
    expect(view([ev('started', '0.1.0.1', { min: 0 }), refused], at(20))).toEqual(['bad limit']);
    const out = ev('value', '0.1.0.1', { min: 2, payload: { values: { reading: { value: '9', unit: '' } }, results: { readingCheck: fail as never } } });
    expect(view([ev('started', '0.1.0.1', { min: 0 }), out], at(20))).toEqual(['Out of limits: Result against limits. Add a deviation note first.']);
    expect(view([ev('started', '0.1.0.1', { min: 0 }), ev('note', '0.1.0.1', { min: 1 }), out], at(20))).toHaveLength(1);
    expect(view([ev('started', '0.1.0.1', { min: 0 }), out, ev('note', '0.1.0.1', { min: 3 })], at(20))).toEqual([]);
  });

  it('TA-16 a screen not intact after use fails the integrity check: the step needs a deviation note', () => {
    const sieve = small([{ steps: [{ block: { id: 'sieve', version: 1 }, settings: {} }] }]);
    const values = { machine: 'MIL-01', screen: '1.0 mm', intactBefore: 'yes', intactAfter: 'no' };
    const results = evaluate(sieve, [], { stage: 0, sub: 1, step: 0, round: 1 }, values);
    expect(results.integrity).toMatchObject({ ok: true, check: { pass: false } });
    const events = [ev('started', '0.1.0.1', { min: 0 }), ev('value', '0.1.0.1', { min: 1, payload: { values, results } })];
    const v = (e: StepEvent[]) => doneProblems(sieve, openSteps(sieve, e, at(5)).steps[0]!, at(5));
    expect(v(events)).toEqual(['Out of limits: Screen integrity. Add a deviation note first.']);
    expect(v([...events, ev('note', '0.1.0.1', { min: 2, payload: { text: 'Screen torn; material re-sieved' } })])).toEqual([]);
  });

  it('TA-10 line clearance: every answer yes is clear; a "no" needs a deviation note; the cleaning label is recorded', () => {
    const lc = small([{ steps: [{ block: { id: 'line-clearance', version: 1 }, checker: true, settings: {} }] }]);
    const key = { stage: 0, sub: 1, step: 0, round: 1 };
    const label = { cleanedOn: '15 Nov 2026 06:40', cleanedBy: 'R. Operator' };
    expect(evaluate(lc, [], key, { previousRemoved: 'yes', clean: 'yes', noOther: 'yes', ...label }).clearance)
      .toMatchObject({ ok: true, check: { pass: true }, shown: 'Line clear: 3 of 3 as expected (yes): pass' });
    const values = { room: 'BLN-01', previousRemoved: 'yes', clean: 'no', noOther: 'yes', ...label };
    const results = evaluate(lc, [], key, values);
    const events = [ev('started', '0.1.0.1', { min: 0 }), ev('value', '0.1.0.1', { min: 1, payload: { values, results } })];
    const v = (e: StepEvent[]) => doneProblems(lc, openSteps(lc, e, at(5)).steps[0]!, at(5));
    expect(v(events)).toEqual(['Out of limits: Line clear. Add a deviation note first.']);
    const partial = [events[0]!, ev('value', '0.1.0.1', { min: 1, payload: { values: { previousRemoved: 'yes' }, results: {} } })];
    expect(v(partial)).toEqual(['Room is not recorded', 'Area and equipment clean (status label) is not recorded', 'Cleaned on (date and time on the label) is not recorded',
      'Cleaned by (name on the label) is not recorded', 'No materials or documents of other products is not recorded']);
  });

  it('a minimum time: a 10-minute mix cannot be done earlier', () => {
    const events = [ev('started', '0.1.0.1', { min: 0 }), ev('value', '0.1.0.1', { min: 1, payload: { values: { reading: { value: '6', unit: '' } }, results: { readingCheck: pass as never } } })];
    expect(view(events, at(9))).toEqual([`The minimum time is 10 min: the step can be finished from ${at(10).toISOString()}`]);
    expect(view(events, at(10))).toEqual([]);
  });
});

describe('timers', () => {
  it('TA-17 an exceeded hold time blocks the using stage until a deviation note', () => {
    const doc = small([{ produces: { name: 'granules', holdHours: 2 } }, { uses: ['s0'] }]);
    const done = [ev('started', '0.1.0.1', { min: 0 }), ev('done', '0.1.0.1', { min: 10 })];
    expect(timers(doc, done, at(60))).toMatchObject([{ id: 'hold:0:1', kind: 'hold', state: 'running', from: at(10), at: at(130), key: { stage: 1, step: 0 } }]);
    expect(timers(doc, done, at(115))[0]!.state).toBe('due soon');
    expect(timers(doc, done, at(131))[0]!.state).toBe('late');
    expect(stateOf(doc, done, '1.1.0.1', at(100))).toBe('open');
    expect(stateOf(doc, done, '1.1.0.1', at(131))).toBe('waiting');
    expect(openSteps(doc, done, at(131)).stages[1]!.blocked).toBe('Hold time of granules (2 h) before Stage 1 ran out: a deviation note is needed');
    // A note made before the hold ran out does not count.
    expect(stateOf(doc, [...done, ev('note', '1.1.0.1', { min: 120 })], '1.1.0.1', at(131))).toBe('waiting');
    expect(stateOf(doc, [...done, ev('note', '1.1.0.1', { min: 131 })], '1.1.0.1', at(132))).toBe('open');
  });

  it('a hold time stops when the using stage starts; started too late, it stays late', () => {
    const doc = small([{ produces: { name: 'granules', holdHours: 2 } }, { uses: ['s0'] }]);
    const done = [ev('started', '0.1.0.1', { min: 0 }), ev('done', '0.1.0.1', { min: 10 })];
    expect(timers(doc, [...done, ev('started', '1.1.0.1', { min: 100 })], at(500))).toEqual([]);
    expect(timers(doc, [...done, ev('note', '1.1.0.1', { min: 140 }), ev('started', '1.1.0.1', { min: 141 })], at(500))[0]!.state).toBe('late');
  });

  it('TA-15 a periodic check is due every 30 minutes from the start of the previous round', () => {
    const doc = small([{ steps: [{ everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 10, stop: 'readingCheck' } }] }]);
    const r1 = [ev('started', '0.1.0.1', { min: 0 }), reading('0.1.0.1', { readingCheck: fail }, { min: 2 }), ev('done', '0.1.0.1', { min: 3 })];
    expect(timers(doc, r1, at(20))).toMatchObject([{ id: 'every:0.1.0.2', kind: 'periodic', state: 'running', at: at(30) }]);
    expect(timers(doc, r1, at(26))[0]!.state).toBe('due soon');
    expect(timers(doc, r1, at(31))[0]!.state).toBe('late');
    const r2 = [...r1, ev('started', '0.1.0.2', { min: 29 })];
    expect(timers(doc, r2, at(40)).map((t) => [t.id, t.state])).toEqual([['every:0.1.0.3', 'running']]);
    const late = [...r1, ev('started', '0.1.0.2', { min: 35 })];
    expect(timers(doc, late, at(40)).map((t) => [t.id, t.state])).toEqual([['every:0.1.0.2', 'late'], ['every:0.1.0.3', 'running']]);
    // Once the stop check passes, no further check is due.
    const end = [...r2, reading('0.1.0.2', { readingCheck: pass }, { min: 30 }), ev('done', '0.1.0.2', { min: 31 })];
    expect(timers(doc, end, at(100))).toEqual([]);
  });

  it('a minimum time runs from the start and is due when it has passed', () => {
    const doc = small([{ steps: [{ minMinutes: 10 }] }]);
    expect(timers(doc, [ev('started', '0.1.0.1', { min: 0 })], at(5))).toMatchObject([{ kind: 'minimum', state: 'running', at: at(10) }]);
    expect(timers(doc, [ev('started', '0.1.0.1', { min: 0 })], at(10))[0]!.state).toBe('due');
    expect(timers(doc, [ev('started', '0.1.0.1', { min: 0 }), ev('done', '0.1.0.1', { min: 11 })], at(12))).toEqual([]);
  });
});

describe('calculations come from the templates library', () => {
  const doc = api();
  const certificate = { assay: { value: '99.0', unit: '%' }, lod: { value: '0.5', unit: '%' } };

  it('the starting material target is the potency-adjusted formula quantity (T9); net (T1) against it (C1)', () => {
    const r = evaluate(doc, [], { stage: 1, sub: 1, step: 0, round: 1 }, { ...certificate, gross: { value: '82.214', unit: 'kg' }, tare: { value: '1.000', unit: 'kg' } });
    // assay as is 99.0 × 99.5 ÷ 100 = 98.505 %; 80.000 × 100 ÷ 98.505 = 81.214 kg
    expect(r.target).toMatchObject({ ok: true, unit: 'kg', shown: '80.0 kg per batch = 80.000 kg; then assay as is = 99.0 % × (100 − 0.5 %) ÷ 100 = 98.505 %; 80.000 kg × 100 ÷ 98.505 % = 81.214 kg' });
    expect(r.net).toMatchObject({ ok: true, value: '81.214', shown: '82.214 kg − 1.000 kg = 81.214 kg' });
    expect(r.netCheck).toMatchObject({ ok: true, check: { pass: true } });
  });

  it('TA-13 without the LOD the T9 refusal is the result, so the step cannot be signed', () => {
    const r = evaluate(doc, [], { stage: 1, sub: 1, step: 0, round: 1 }, { assay: { value: '99.0', unit: '%' } });
    expect(r.target).toEqual({ ok: false, message: "The dried assay needs the lot's loss on drying" });
    expect(r.netCheck).toBeUndefined();
  });

  it('TA-13 a reagent by equivalents (T28) is worked out on the planned key input, then on the starting material actually weighed', () => {
    const amine = { stage: 1, sub: 1, step: 1, round: 1 };
    const assay = { assay: { value: '100.0', unit: '%' } };
    // 80.0 kg ÷ 200.0 = 400 mol × 1.10 eq × 150.0 g/mol = 66.000 kg
    expect(evaluate(doc, [], amine, assay).target).toMatchObject({ ok: true, unit: 'kg', shown: expect.stringMatching(/^80\.0 kg ÷ 200\.0 g\/mol = 400\.000 mol × 1\.10 eq × 150\.0 g\/mol = 66\.000 kg \(on the planned Examplol acid 80\.0 kg\)/) });
    const weighed = { ...certificate, gross: { value: '82.000', unit: 'kg' }, tare: { value: '1.000', unit: 'kg' } };
    const ksm = evaluate(doc, [], { stage: 1, sub: 1, step: 0, round: 1 }, weighed);
    const events = [ev('value', '1.1.0.1', { payload: { values: weighed, results: ksm } })];
    // 81.000 kg ÷ 200.0 = 405 mol × 1.10 × 150.0 = 66.825 kg
    const target = evaluate(doc, events, amine, assay).target as { value: string; shown: string };
    expect(Number(target.value).toFixed(3)).toBe('66.825');
    expect(target.shown).toMatch(/\(on the actual Examplol acid 81\.000 kg\)/);
  });

  it('T28 the molar theoretical yield of a stage, on its starting material; quantities per kg and equivalents of the next stage on its intermediate', () => {
    expect(evaluate(doc, [], { stage: 1, sub: 1, step: 6, round: 1 }, {}).theoretical).toMatchObject({ ok: true, value: '132', shown: '80.0 kg ÷ 200.0 g/mol = 400.000 mol × 330.0 g/mol (theoretical) = 132.000 kg' });
    const H = { stage: 2, sub: 1, step: 0, round: 1 };
    const line = (k: string) => doc.formula.find((l) => l.key === k)!;
    expect(lineQuantity(doc, [], H, line('ipa'), false, {})).toMatchObject({ ok: true, value: '480', unit: 'L' });
    // 120.0 kg ÷ 330.0 = 363.636 mol × 1.05 × 36.46 g/mol = 13.921 kg ÷ 1.17 kg/L = 11.90 L
    expect(lineQuantity(doc, [], H, line('hcl'), false, {})).toMatchObject({ ok: true, unit: 'L', shown: expect.stringMatching(/= 11\.90 L \(on the planned intermediate 1 120\.0 kg\)$/) });
    const out = ev('value', '1.1.6.1', { payload: { values: { output: { value: '118.0', unit: 'kg' } }, results: {} } });
    expect(lineQuantity(doc, [out], H, line('ipa'), false, {})).toMatchObject({ ok: true, value: '472', shown: '4.0 L/kg × 118.0 = 472.00 L (on the actual intermediate 1 118.0 kg)' });
  });
});

describe('corrections reach the steps that used the value', () => {
  const doc = api();
  const assay = { assay: { value: '100.0', unit: '%' } };
  const ksmKey = { stage: 1, sub: 1, step: 0, round: 1 };
  const amineKey = { stage: 1, sub: 1, step: 1, round: 1 };
  const cert = { assay: { value: '99.0', unit: '%' }, lod: { value: '0.5', unit: '%' } };
  const ksm = (gross: string) => ({ ...cert, gross: { value: gross, unit: 'kg' }, tare: { value: '1.000', unit: 'kg' } });
  const recorded = ev('value', '1.1.0.1', { payload: { values: ksm('82.000'), results: evaluate(doc, [], ksmKey, ksm('82.000')) } });
  const weighed = [ev('started', '1.1.0.1'), recorded, ev('done', '1.1.0.1')];
  const uses: number[] = [];
  // 66.825 kg of the amine on 81.000 kg of starting material
  const amine = { ...assay, gross: { value: '67.825', unit: 'kg' }, tare: { value: '1.000', unit: 'kg' } };
  const amineResults = evaluate(doc, weighed, amineKey, amine, uses);
  const both = [...weighed, ev('started', '1.1.1.1'), ev('value', '1.1.1.1', { payload: { values: amine, results: amineResults, uses } }), ev('done', '1.1.1.1')];
  const fix = (events: StepEvent[], kind: 'corrected' | 'value') =>
    ev(kind, '1.1.0.1', { person: 4, payload: { values: ksm('81.000'), results: evaluate(doc, events, ksmKey, ksm('81.000')), reason: 'Gross weight typed from the wrong ticket' } });
  const corrected = [...both, fix(both, 'corrected')];
  const amineView = (events: StepEvent[]) => openSteps(doc, events, at(1000)).steps.find((s) => s.id === '1.1.1.1')!;

  it('each result keeps the events it was worked out from', () => {
    expect(uses).toEqual([recorded.id]);
    expect(amineView(both)).toMatchObject({ state: 'done_awaiting_check', needsResign: false, inputChanged: [] });
  });

  it.each<[string, StepEvent[], string, boolean, number]>([
    ['nothing changed since', both, 'done_awaiting_check', false, 0],
    ['the starting material weight was corrected after the amine target used it', corrected, 'in_progress', true, 1],
  ])('TA-06 %s → amine weighing %s, sign again %s, %d input change(s)', (_what, events, state, resign, changes) => {
    const v = amineView(events);
    expect([v.state, v.needsResign, v.inputChanged.length]).toEqual([state, resign, changes]);
  });

  it('TA-06 the stale step shows the result worked out again (not stored), which input changed and by whom; signing again stores it', () => {
    const v = amineView(corrected);
    expect(v.inputChanged).toMatchObject([{ kind: 'corrected', person: 4, stage: 1, step: 0, payload: { reason: 'Gross weight typed from the wrong ticket' } }]);
    // On 80.000 kg the target is 66.000 kg: the 66.825 kg weighed is now 1.25 % over, outside ± 0.5 %.
    expect(v.results.netCheck).toMatchObject({ ok: true, check: { pass: false } });
    expect(currentValues(v.events).results.netCheck).toMatchObject({ check: { pass: true } });
    const again: number[] = [];
    const resigned = [...corrected, ev('done', '1.1.1.1', { payload: { results: evaluate(doc, corrected, amineKey, amine, again), uses: again } })];
    expect(amineView(resigned)).toMatchObject({ state: 'done_awaiting_check', needsResign: false, inputChanged: [], results: { netCheck: { check: { pass: false } } } });
  });

  it('TA-06 a checked step goes back for signing and checking again; a correction of the step that used it does not count', () => {
    const checked = [...both.slice(0, -1), ev('done', '1.1.1.1'), ev('checked', '1.1.1.1', { person: 2 })];
    const changed = [...checked, fix(checked, 'corrected')];
    expect(stepState(changed.filter((e) => e.stage === 1 && e.step === 1), true).state).toBe('checked');
    expect(amineView(changed)).toMatchObject({ state: 'in_progress', needsResign: true });
    const ownFix = ev('corrected', '1.1.1.1', { payload: { values: amine, results: evaluate(doc, changed, amineKey, amine, []), uses: [changed.at(-1)!.id], reason: 'Re-weighed' } });
    expect(amineView([...changed, ownFix]).inputChanged).toEqual([]);
  });
});

describe('repeat-until: no further change from the previous round (F2)', () => {
  const doc = small([{ steps: [{ block: { id: 'dry-constant', version: 1 }, settings: { maxChange: '0.05 g' }, flow: { kind: 'repeat-until', maxRounds: 5 } }, {}] }]);
  const g = (x: string) => ({ weight: { value: x, unit: 'g' } });
  const round = (events: StepEvent[], r: number, w: string) => {
    const key = { stage: 0, sub: 1, step: 0, round: r };
    const uses: number[] = [];
    const results = evaluate(doc, events, key, g(w), uses);
    return [...events, ev('started', `0.1.0.${r}`), ev('value', `0.1.0.${r}`, { payload: { values: g(w), results, uses } }), ev('done', `0.1.0.${r}`)];
  };

  it('round 1 has no previous reading: the stop check waits and round 2 opens', () => {
    const r1 = round([], 1, '10.00');
    expect(openSteps(doc, r1, at(1000)).steps[0]!.results.constant).toBeUndefined();
    expect(stateOf(doc, r1, '0.1.0.2')).toBe('open');
  });

  it.each([
    ['10.30', '10.00', false],
    ['10.03', '10.00', true],
    ['10.05', '10.00', true],
    ['9.94', '10.00', false],
  ])('F2 this round %s g against the previous round %s g (largest change 0.05 g) → stop %s', (now, before, stop) => {
    const r2 = round(round([], 1, before), 2, now);
    expect(openSteps(doc, r2, at(1000)).steps.find((s) => s.id === '0.1.0.2')!.results.constant).toMatchObject({ ok: true, check: { pass: stop } });
    expect(stateOf(doc, r2, '0.1.1.1')).toBe(stop ? 'open' : 'waiting');
    expect(stateOf(doc, r2, '0.1.0.3')).toBe(stop ? 'absent' : 'open');
  });

  it('a round uses the previous round only when its block refers to it ("$prev.name")', () => {
    const plain = small([{ steps: [{ flow: { kind: 'repeat-until', maxRounds: 3, stop: 'readingCheck' } }] }]);
    const r1 = [ev('value', '0.1.0.1', { payload: { values: { reading: { value: '8', unit: '' } }, results: {} } })];
    const uses: number[] = [];
    evaluate(plain, r1, { stage: 0, sub: 1, step: 0, round: 2 }, { reading: { value: '6', unit: '' } }, uses);
    expect(uses).toEqual([]);
    evaluate(doc, r1, { stage: 0, sub: 1, step: 0, round: 2 }, g('10.00'), uses);
    expect(uses).toEqual([r1[0]!.id]);
  });

  it('TA-06 correcting the previous round marks this round "input changed"', () => {
    const r2 = round(round([], 1, '10.00'), 2, '10.02');
    const fix = ev('corrected', '0.1.0.1', { payload: { values: g('10.20'), results: {}, reason: 'Misread' } });
    const v = openSteps(doc, [...r2, fix], at(1000)).steps.find((s) => s.id === '0.1.0.2')!;
    expect([v.state, v.needsResign, v.results.constant?.ok && v.results.constant.check?.pass]).toEqual(['in_progress', true, false]);
  });
});

describe('yield accountability (T4)', () => {
  const values = { output: { value: '98.000', unit: 'kg' }, samples: { value: '0.800', unit: 'kg' }, rejects: { value: '0.400', unit: 'kg' } };
  const key = { stage: 2, sub: 1, step: 1, round: 1 };
  it.each([
    ['with accountability limits', true],
    ['without accountability limits', false],
  ])('TA-18 yield and accountability are worked out %s; the limits only add the check', (_what, limits) => {
    const doc = api();
    if (!limits) delete doc.stages[2]!.steps[1]!.settings.accountabilityLimit;
    const r = evaluate(doc, [], key, values);
    // (98.000 + 0.800 + 0.400) ÷ 100.000 × 100 = 99.20 %; yield 98.000 ÷ 100.000 × 100 = 98.00 %
    expect(r.accountability).toMatchObject({ ok: true, value: '99.2' });
    expect((r.accountability as { check?: unknown }).check !== undefined).toBe(limits);
    expect(r.yield).toMatchObject({ ok: true, value: '98', check: { pass: true } });
  });
});

describe('steps as people name them', () => {
  it('a step is named by the master, or by its block and material; a waiting step names the step it waits for, never its key', () => {
    const doc = api();
    expect(stepTitle(doc, doc.stages[1]!.steps[0]!)).toBe('Weigh a material: Examplol acid');
    expect(stepLabel(doc, { stage: 1, sub: 1, step: 4, round: 2 })).toBe('Step 1: condensation › Dry to an LOD limit (round 2)');
    const named = small([{ steps: [{ name: 'Punch and die check — before compression', checker: true }, {}] }]);
    expect(stepTitle(named, named.stages[0]!.steps[0]!)).toBe('Punch and die check — before compression');
    const v = openSteps(named, [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')], at(10)).steps.find((x) => x.id === '0.1.1.1')!;
    expect(v.blocked).toBeUndefined();
    const wait = small([{ steps: [{ name: 'Granulate to the end point', checker: true, waitForCheck: true }, {}] }]);
    expect(openSteps(wait, [ev('started', '0.1.0.1'), ev('done', '0.1.0.1')], at(10)).steps[1]!.blocked).toBe('Waits for “Granulate to the end point” to be checked');
  });
});
