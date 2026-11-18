// Screen 3: the formula (plan 3c.2). One row per material picked from master data, the stage that charges it, its role,
// its quantity (per batch in kg or L, per kg of the stage's key input, or in molar equivalents of it, T28), its
// molecular weight and density where needed, and the batch quantity worked out; the adjustment panel for the selected line.
import { useState } from 'react';
import type { MasterData, MasterRow } from '../api-designer.js';
import type { Problem } from '../../../shared/master/checks.js';
import { keyInput, lineQuantity } from '../../../shared/engine/index.js';
import { ROLES, type FormulaLine, type MasterDoc } from '../../../shared/master/schema.js';
import { AnswerBox, type OnAnswer } from './CheckPanel.js';
import { move, newKey, qtyText } from './model.js';
import { Decimal, Order, Picker } from './ui.js';

type Adjust = NonNullable<FormulaLine['adjust']>;
const HERE = { stage: 0, sub: 1, step: 0, round: 1 };
// How a line's quantity is given: the unit of its quantity, or equivalents (as a mass, or as a volume by its density).
const HOW = [['kg', 'kg per batch'], ['L', 'L per batch'], ['units', 'units per batch'], ['L/kg', 'L per kg of key input'], ['kg/kg', 'kg per kg of key input'], ['eq', 'eq (as kg)'], ['eq L', 'eq (as L)']] as const;
const howOf = (l: FormulaLine) => (l.eq !== undefined ? (l.unit === 'L' ? 'eq L' : 'eq') : l.unit ?? 'kg');
function withHow(l: FormulaLine, how: string): FormulaLine {
  const { eq: _e, quantity: _q, unit: _u, ...rest } = l;
  const n = l.eq ?? l.quantity ?? '';
  if (how === 'eq' || how === 'eq L') return { ...rest, eq: n, ...(how === 'eq L' ? { unit: 'L' as const } : {}) };
  return { ...rest, quantity: n, unit: how as FormulaLine['unit'] };
}

export function FormulaTable({ doc, onChange, md, masters, selected, onSelect, problems, onAnswer }: {
  doc: MasterDoc; onChange: (d: MasterDoc) => void; md: MasterData; masters: MasterRow[]; selected?: number; onSelect: (i?: number) => void; problems: Problem[]; onAnswer?: OnAnswer;
}) {
  const [adding, setAdding] = useState(false);
  const lines = doc.formula;
  const set = (formula: FormulaLine[]) => onChange({ ...doc, formula });
  const put = (i: number, l: FormulaLine) => set(lines.map((x, j) => (j === i ? l : x)));
  const linked = [...new Set(masters.filter((m) => m.header.productItemId === doc.header.productItemId).flatMap((m) => m.materialIds))];
  const opt = (l: FormulaLine, k: 'mw' | 'density', v: string) => { const next: FormulaLine = { ...l, [k]: v }; if (!v) delete next[k]; return next; };
  const sel = selected === undefined ? undefined : lines[selected];

  return (
    <>
      <div className="card">
        <div className="d-section-head"><h2>Formula</h2><span className="muted small">Each material in the stage that charges it. Equivalents and quantities per kg are worked out on the stage's key input: its starting material, or the intermediate it uses.</span></div>
        <div className="table-wrap">
          <table className="plain-table formula-table">
            <thead><tr><th>Material</th><th>Stage</th><th>Role</th><th>Quantity</th><th>MW (g/mol)</th><th>Density (kg/L)</th><th>Batch quantity</th><th>Adjustment</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const bad = problems.some((p) => p.path.startsWith(`formula[${i}]`) && p.level === 'error');
                const how = howOf(l);
                const key = keyInput(doc, l.stage);
                return (
                  <tr key={l.key} className={selected === i ? 'sel' : bad ? 'bad-row' : ''} onClick={() => onSelect(i)}>
                    <td><b>{l.code}</b><span className="cell-sub">{l.name}</span></td>
                    <td><select aria-label={`Stage of ${l.name}`} value={l.stage} onChange={(e) => put(i, { ...l, stage: e.target.value })}>
                      {!doc.stages.some((s) => s.key === l.stage) && <option value={l.stage}>(choose)</option>}
                      {doc.stages.filter((s) => s.kind !== 'preparation' || true).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></td>
                    <td><select aria-label={`Role of ${l.name}`} value={l.role} onChange={(e) => put(i, { ...l, role: e.target.value as FormulaLine['role'] })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                    <td className="nowrap"><Decimal label={`Quantity of ${l.name}`} value={l.eq ?? l.quantity} onChange={(v) => put(i, l.eq !== undefined ? { ...l, eq: v } : { ...l, quantity: v })} />
                      <select aria-label={`Unit of ${l.name}`} value={how} onChange={(e) => put(i, withHow(l, e.target.value))}>
                        {HOW.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                      {!['kg', 'L', 'units'].includes(how) && <span className="cell-sub">{key ? `of ${key.name}` : 'the stage has no key input'}</span>}</td>
                    <td><Decimal label={`Molecular weight of ${l.name}`} placeholder="—" value={l.mw} onChange={(v) => put(i, opt(l, 'mw', v))} /></td>
                    <td><Decimal label={`Density of ${l.name}`} placeholder="—" value={l.density} onChange={(v) => put(i, opt(l, 'density', v))} /></td>
                    <td className="nowrap num">{qtyText(lineQuantity(doc, [], HERE, l, false, {}))}</td>
                    <td><button type="button" className="link dark" onClick={(e) => { e.stopPropagation(); onSelect(i); }}>{adjustSummary(l.adjust)}</button></td>
                    <td><Order index={i} count={lines.length} what={l.name} onMove={(by) => set(move(lines, i, by))} onRemove={() => { set(lines.filter((_, j) => j !== i)); onSelect(undefined); }} /></td>
                  </tr>
                );
              })}
              {!lines.length && <tr><td colSpan={9} className="muted">No materials yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {adding ? (
          <div className="add-box">
            <Picker label="Material" first={linked} firstLabel={`Materials of ${doc.header.productCode} in other masters`}
              items={md.materials.map((m) => ({ id: m.itemId, code: m.code, name: m.name, note: m.category ?? undefined, off: !m.active ? 'inactive' : undefined }))}
              onPick={(m) => {
                const line: FormulaLine = { key: newKey(m.code, lines.map((l) => l.key)), materialItemId: m.id, code: m.code, name: m.name,
                  stage: doc.stages[0]?.key ?? '', role: 'reagent', quantity: '', unit: 'kg' };
                set([...lines, line]); onSelect(lines.length); setAdding(false);
              }} />
            <div className="actions"><button type="button" onClick={() => setAdding(false)}>Close</button></div>
          </div>
        ) : <div className="row"><button type="button" onClick={() => setAdding(true)}>+ Add a material</button></div>}
      </div>
      {sel && selected !== undefined && <AdjustPanel line={sel} md={md} onChange={(l) => put(selected, l)} problems={problems.filter((p) => p.path.startsWith(`formula[${selected}]`))} onAnswer={onAnswer} />}
    </>
  );
}

function adjustSummary(a: Adjust | undefined): string {
  if (!a) return 'None';
  const parts = [a.salt && 'salt factor', a.potency && `assay (${a.potency.basis})`, a.content && 'content', a.overage && `overage ${a.overage.percent} %`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'None';
}

/** The "Adjustment" panel: the settings of the dispensing templates (T11, T9 or T18, T16), in this order. */
function AdjustPanel({ line, md, onChange, problems, onAnswer }: { line: FormulaLine; md: MasterData; onChange: (l: FormulaLine) => void; problems: Problem[]; onAnswer?: OnAnswer }) {
  const a: Adjust = line.adjust ?? {};
  const put = (next: Adjust) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as Adjust;
    const { adjust: _, ...rest } = line;
    onChange(Object.keys(clean).length ? { ...rest, adjust: clean } : rest);
  };
  const mode = a.potency ? 'potency' : a.content ? 'content' : 'none';
  const form = (which: 'from' | 'to', label: string) => {
    const f = a.salt?.[which] ?? { name: '', mw: '' };
    const setF = (x: Partial<typeof f>) => put({ ...a, salt: { from: a.salt?.from ?? { name: '', mw: '' }, to: a.salt?.to ?? { name: '', mw: '' }, [which]: { ...f, ...x } } });
    return (
      <div className="form-grid">
        <label>{label}<input aria-label={`${label} name`} value={f.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. base" /></label>
        <label>Molecular weight<Decimal label={`${label} molecular weight`} value={f.mw} onChange={(mw) => setF({ mw })} /></label>
        <label>Drug molecules per formula unit<input type="number" min={1} max={4} aria-label={`${label} molecules per formula unit`} value={f.moleculesPerUnit ?? 1} onChange={(e) => setF({ moleculesPerUnit: Number(e.target.value) > 1 ? Number(e.target.value) : undefined })} /></label>
        {which === 'from' && <label>Ion charge (for mEq)<input type="number" min={1} max={4} aria-label={`${label} ion charge`} value={f.charge ?? ''} onChange={(e) => setF({ charge: Number(e.target.value) || undefined })} /></label>}
        {which === 'to' && <label className="check"><input type="checkbox" checked={!!f.hydrateOrSolvate} onChange={(e) => setF({ hydrateOrSolvate: e.target.checked || undefined })} />Its molecular weight includes crystal water or solvent</label>}
      </div>
    );
  };
  return (
    <div className="card adjust">
      <div className="d-section-head"><h2>Adjustment of {line.name} at dispensing</h2><span className="muted small">Worked out with the lot's certificate values; the templates refuse settings that would count water twice.</span></div>
      {line.role !== 'solvent' || a.potency || a.content || a.salt ? (
        <>
          <fieldset className="checklist">
            <legend>Salt form</legend>
            <label className="check"><input type="checkbox" checked={!!a.salt} onChange={(e) => put({ ...a, salt: e.target.checked ? { from: { name: 'base', mw: '' }, to: { name: '', mw: '' } } : undefined })} />
              The formula gives the quantity of another form (base, salt, element)</label>
            {a.salt && <>{form('from', 'Form in the formula')}{form('to', 'Form dispensed')}
              <label>Salt factor as written in the formula (optional, checked against the molecular weights)<Decimal label="Salt factor as written" placeholder="none" value={a.salt.factor}
                onChange={(factor) => put({ ...a, salt: { ...a.salt!, factor: factor || undefined } })} /></label></>}
          </fieldset>
          <fieldset className="checklist">
            <legend>Adjust for the lot</legend>
            <div className="seg small-seg" role="radiogroup" aria-label="Adjust for the lot">
              {(['none', 'potency', 'content'] as const).map((m) => (
                <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''}
                  onClick={() => put({ ...a, potency: m === 'potency' ? a.potency ?? { basis: 'as is', standardIs: 'anhydrous' } : undefined, content: m === 'content' ? a.content ?? { formulaQuantityIs: 'dry' } : undefined })}>
                  {m === 'none' ? 'No' : m === 'potency' ? 'Assay' : 'Content'}</button>
              ))}
            </div>
            {a.potency && (
              <div className="form-grid">
                <label>Assay basis<select value={a.potency.basis} onChange={(e) => put({ ...a, potency: { ...a.potency!, basis: e.target.value as 'as is' } })}>
                  {['as is', 'anhydrous', 'dried', 'ignited', 'anhydrous and solvent-free'].map((b) => <option key={b}>{b}</option>)}</select></label>
                <label>The formula quantity is the<select value={a.potency.standardIs ?? ''} onChange={(e) => put({ ...a, potency: { ...a.potency!, standardIs: (e.target.value || undefined) as 'anhydrous' } })}>
                  <option value="">(not stated)</option><option value="anhydrous">anhydrous weight</option><option value="hydrate or solvate">hydrate or solvate weight</option></select></label>
                <label>Potency stated<select value={a.potency.potencyAs ?? ''} onChange={(e) => put({ ...a, potency: { ...a.potency!, potencyAs: (e.target.value || undefined) as 'parent' } })}>
                  <option value="">as the substance</option><option value="parent">as parent (µg parent per mg)</option><option value="element">as element (% Ca, Zn, Fe)</option></select></label>
                <label>An assay above 100 %<select value={a.potency.assayAbove100 ?? 'use'} onChange={(e) => put({ ...a, potency: { ...a.potency!, assayAbove100: e.target.value === 'use' ? undefined : 'treat as 100' } })}>
                  <option value="use">is used as found</option><option value="treat as 100">is taken as 100 %</option></select></label>
                <label>The assay is expressed as<select value={a.potency.assayExpressedAs ?? ''} onChange={(e) => put({ ...a, potency: { ...a.potency!, assayExpressedAs: (e.target.value || undefined) as 'hydrate' } })}>
                  <option value="">(not stated)</option><option value="anhydrous substance">the anhydrous substance</option><option value="hydrate">the hydrate</option></select></label>
              </div>
            )}
            {a.content && (
              <div className="form-grid">
                <label>The formula quantity is<select value={a.content.formulaQuantityIs} onChange={(e) => put({ ...a, content: { ...a.content!, formulaQuantityIs: e.target.value as 'dry' } })}>
                  <option value="dry">of the pure (dry) material</option><option value="wet">of the material as supplied</option></select></label>
                <label>Nominal content (%)<Decimal label="Nominal content" value={a.content.nominalContent} onChange={(v) => put({ ...a, content: { ...a.content!, nominalContent: v || undefined } })} /></label>
                <label>The content comes from<select value={a.content.contentSource ?? 'certificate'} onChange={(e) => put({ ...a, content: { ...a.content!, contentSource: e.target.value === 'certificate' ? undefined : 'in-process result' } })}>
                  <option value="certificate">the lot's certificate</option><option value="in-process result">an in-process result (granule or blend assay)</option></select></label>
                {a.content.contentSource === 'in-process result' && <label>The in-process result is<select value={a.content.resultType ?? ''} onChange={(e) => put({ ...a, content: { ...a.content!, resultType: (e.target.value || undefined) as 'content' } })}>
                  <option value="">(not stated)</option><option value="content">the content (% w/w)</option><option value="percent of theoretical">% of theoretical (nominal content above)</option></select></label>}
              </div>
            )}
          </fieldset>
        </>
      ) : null}
      {/* TA-24: a solvent the master allows to be charged recovered too (its own material, tested and released in MMS). */}
      {line.role === 'solvent' && (
        <fieldset className="checklist">
          <legend>Recovered solvent</legend>
          <label>Recovered material allowed on this line (a lot of either may be charged)
            <select aria-label={`Recovered material of ${line.name}`} value={line.recovered?.materialItemId ?? ''} onChange={(e) => {
              const m = md.materials.find((x) => x.itemId === e.target.value);
              const { recovered: _, ...rest } = line;
              onChange(m ? { ...rest, recovered: { materialItemId: m.itemId, code: m.code, name: m.name } } : rest);
            }}>
              <option value="">(none: fresh solvent only)</option>
              {md.materials.filter((m) => m.active && m.itemId !== line.materialItemId).map((m) => <option key={m.itemId} value={m.itemId}>{m.code} {m.name}</option>)}
            </select></label>
        </fieldset>
      )}
      {/* An overage on any line (T16). */}
      <fieldset className="checklist">
        <legend>Overage</legend>
        <div className="form-grid">
          <label>Overage (%)<Decimal label="Overage percent" placeholder="none" value={a.overage?.percent} onChange={(v) => put({ ...a, overage: v ? { ...a.overage, percent: v } : undefined })} /></label>
          {a.overage && <label>Highest overage allowed (%)<Decimal label="Highest overage allowed" value={a.overage.maxPercent} onChange={(v) => put({ ...a, overage: { ...a.overage!, maxPercent: v || undefined } })} /></label>}
        </div>
      </fieldset>
      {problems.map((p, i) => <div key={i} className={p.level === 'error' ? 'error' : 'notice'}>{p.level === 'error' ? '⛔' : '⚠️'} {p.message}{p.question && <AnswerBox key={p.question.key} p={p} onAnswer={onAnswer} />}</div>)}
    </div>
  );
}
