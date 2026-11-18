// Screen 2: the header (the API as a material of master data, the API expected in kg, its molecular weight and retest
// period) and the new-master dialog with what the master starts from: empty, a process skeleton, or a copy of another
// master (scaled to the batch size).
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api.js';
import { createMaster, getVersion, STATE_LABEL, type MasterData, type MasterRow } from '../api-designer.js';
import { masterSchema, type MasterDoc } from '../../../shared/master/schema.js';
import { dispensingRoomChoices, scaleDoc } from './model.js';
import { SKELETON_LIST, skeletonStages } from './skeletons.js';
import { ChipSet, Decimal, Picker } from './ui.js';

type Header = MasterDoc['header'];

export function HeaderFields({ header, onChange, md }: { header: Header; onChange: (h: Header) => void; md: MasterData }) {
  const material = md.materials.find((m) => m.itemId === header.productItemId);
  const rooms = dispensingRoomChoices(md);
  const [picking, setPicking] = useState(!header.productItemId);
  const set = (k: keyof Header, v: string) => onChange({ ...header, [k]: v });
  const optional = (k: 'mw', v: string) => onChange(v ? { ...header, [k]: v } : (({ [k]: _, ...h }) => h)(header) as Header);
  return (
    <div className="header-fields">
      <div>
        <span className="field-label">API (a material of master data, so MMS can stock its lots)</span>
        {header.productItemId && !picking ? (
          <dl className="fields pulled">
            <div><dt>Code</dt><dd>{header.productCode}</dd></div>
            <div><dt>Name</dt><dd>{header.productName}</dd></div>
            <div><dt>Category</dt><dd>{material?.category ?? '—'}</dd></div>
            <div><dt /><dd><button type="button" className="link dark" onClick={() => setPicking(true)}>Change the API</button></dd></div>
          </dl>
        ) : (
          <Picker label="API" items={md.materials.map((m) => ({ id: m.itemId, code: m.code, name: m.name, note: m.category ?? undefined, off: m.active ? undefined : 'inactive' }))}
            onPick={(i) => { onChange({ ...header, productItemId: i.id, productCode: i.code, productName: i.name }); setPicking(false); }} />
        )}
      </div>
      <div className="form-grid">
        <label>Batch size (kg of API expected)<Decimal label="Batch size (kg of API expected)" value={header.batchSize} onChange={(v) => set('batchSize', v)} width={9} /></label>
        <label>Molecular weight of the API as isolated (g/mol)<Decimal label="Molecular weight of the API (g/mol)" placeholder="not given" value={header.mw} onChange={(v) => optional('mw', v)} /></label>
        <label>Retest period (months)<input className="dec" aria-label="Retest period (months)" inputMode="numeric" style={{ width: '5em' }} value={header.retestMonths || ''}
          onChange={(e) => onChange({ ...header, retestMonths: Number(e.target.value.trim()) || 0 })} /></label>
      </div>
      {/* TA-11: a balance is offered in these rooms or in a room the stage allows. */}
      <ChipSet label="Dispensing rooms (where the materials are weighed)" values={header.dispensingRooms ?? []} options={rooms.options} groups={rooms.groups} text={rooms.text}
        onChange={(dispensingRooms) => onChange({ ...header, dispensingRooms })} empty="None chosen yet: choose the rooms of master data where the materials are weighed" />
    </div>
  );
}

type Start = { kind: 'empty' } | { kind: 'skeleton'; id: string } | { kind: 'copy'; versionId: number };

/** New master (or a copy of one): the header, and what it starts from. */
export function NewMaster({ md, masters, copyOf, onCreated, onCancel }: {
  md: MasterData; masters: MasterRow[]; copyOf?: MasterRow; onCreated: (id: number) => void; onCancel: () => void;
}) {
  // A new master starts with no dispensing rooms: the author picks them. A copy: those it names.
  const [header, setHeader] = useState<Header>({
    ...(copyOf?.header ?? { productItemId: '', productCode: '', productName: '', batchSize: '', retestMonths: 0 }) });
  const skeletons = SKELETON_LIST;
  const [start, setStart] = useState<Start>(copyOf ? { kind: 'copy', versionId: copyOf.id } : { kind: 'skeleton', id: skeletons[0]!.id });
  const [source, setSource] = useState<MasterDoc | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (start.kind !== 'copy') return setSource(null);
    void getVersion(start.versionId).then((v) => {
      setSource(v.doc);
      setHeader((h) => ({ ...h, batchSize: h.batchSize || v.doc.header.batchSize, retestMonths: h.retestMonths || v.doc.header.retestMonths,
        ...(v.doc.header.mw && !h.mw ? { mw: v.doc.header.mw } : {}) }));
    });
  }, [start.kind === 'copy' ? start.versionId : 0]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    let doc: MasterDoc = { header, formula: [], stages: [] };
    if (start.kind === 'skeleton') doc.stages = skeletonStages(start.id, header);
    if (start.kind === 'copy' && source) doc = { ...scaleDoc(source, header.batchSize), header };
    const parsed = masterSchema.safeParse(doc);
    if (!header.productItemId) return setError('Pick the API.');
    const NAMES: Record<string, string> = { batchSize: 'Batch size', retestMonths: 'Retest period', mw: 'Molecular weight' };
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${NAMES[String(i.path.at(-1))] ?? i.path.join('.')}: ${i.message}`).join('; '));
    setBusy(true);
    try {
      onCreated((await createMaster(parsed.data)).id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  const scaled = start.kind === 'copy' && source && header.batchSize !== source.header.batchSize;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={copyOf ? 'Copy a master' : 'New master'}>
      <form className="card dialog wide" onSubmit={submit}>
        <h2>{copyOf ? `Copy ${copyOf.header.productCode} version ${copyOf.versionNo}` : 'New master'}</h2>
        <HeaderFields header={header} onChange={setHeader} md={md} />
        <fieldset className="checklist">
          <legend>Start from</legend>
          {skeletons.map((s) => (
            <label key={s.id} className="check route"><input type="radio" name="start" checked={start.kind === 'skeleton' && start.id === s.id} onChange={() => setStart({ kind: 'skeleton', id: s.id })} />
              <span>Process skeleton: {s.name}<small>{s.text}</small></span></label>
          ))}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'copy'} onChange={() => masters[0] && setStart({ kind: 'copy', versionId: copyOf?.id ?? masters[0].id })} disabled={!masters.length} />
            <span>A copy of another master<small>Formula and process are copied; quantities per batch scale to the new batch size.</small></span></label>
          {start.kind === 'copy' && (
            <select aria-label="Master to copy" value={start.versionId} onChange={(e) => { setStart({ kind: 'copy', versionId: Number(e.target.value) }); }}>
              {masters.map((m) => <option key={m.id} value={m.id}>{m.header.productCode} {m.header.productName} · {m.header.batchSize} kg · version {m.versionNo} ({STATE_LABEL[m.state]})</option>)}
            </select>
          )}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'empty'} onChange={() => setStart({ kind: 'empty' })} />
            <span>Empty<small>No formula and no stages yet.</small></span></label>
        </fieldset>
        {scaled && <p className="notice small">Copy to a new batch size: {source!.header.batchSize} → {header.batchSize} kg. Quantities per batch scale; equivalents and quantities per kg of a key input stay.</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>Create draft</button>
        </div>
      </form>
    </div>
  );
}
