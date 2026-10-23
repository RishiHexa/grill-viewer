import type { Connection, Grill, Issue, Notch, PanelView, Selection } from './types';
import { fmt, fmtPoint, raw, type Precision } from './format';
import { arr } from './model';

interface Props {
  view: PanelView | null;
  grillIndex?: number;
  related: Set<number>;
  precision: Precision;
  onSelect(sel: Selection | null): void;
}

export function Details({ view, grillIndex, related, precision, onSelect }: Props) {
  if (!view) {
    return (
      <div className="details">
        <p>Click a panel or grill in the drawing to inspect its stored values.</p>
        <p className="muted">Values are shown at the selected display precision. Hover any value to see it exactly as stored.</p>
      </div>
    );
  }
  const g = grillIndex !== undefined ? view.grills[grillIndex] : undefined;
  return g && grillIndex !== undefined ? (
    <GrillDetails view={view} g={g} gi={grillIndex} related={related} p={precision} onSelect={onSelect} />
  ) : (
    <PanelDetails view={view} p={precision} onSelect={onSelect} />
  );
}

function Row({ k, v, p, shown }: { k: string; v: unknown; p: Precision; shown?: string }) {
  return (
    <tr>
      <th>{k}</th>
      <td title={raw(v)}>{shown ?? fmt(v, p)}</td>
    </tr>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="ok">No issues found by the checks.</p>;
  return (
    <ul className="issues compact">
      {issues.map((i, n) => (
        <li key={n} className={`sev-${i.severity}`}>
          <span className="sev">{i.severity}</span>
          {i.grillId && <b>{i.grillId}: </b>}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function PanelDetails({ view, p, onSelect }: { view: PanelView; p: Precision; onSelect: Props['onSelect'] }) {
  const pnl = view.panel;
  const md = pnl.metadata;
  // Grouped by exact stored length (not the formatted value), so near-equal lengths stay separate.
  const lengths = new Map<string, { type: unknown; length: unknown; qty: number }>();
  for (const g of view.grills) {
    const k = `${raw(g.type)}|${raw(g.length)}`;
    const e = lengths.get(k);
    if (e) e.qty++;
    else lengths.set(k, { type: g.type, length: g.length, qty: 1 });
  }

  return (
    <div className="details">
      <span className="chip">{fmt(pnl.rowType)}</span>
      <h2>Panel P{view.index + 1}</h2>
      <table className="kv">
        <tbody>
          {pnl.format && <Row k="format" v={pnl.format} p={p} shown={`threeDGrills v ${fmt(pnl.format.v, 'full')}`} />}
          <Row k="id" v={pnl.id} p={p} />
          <Row k="rowIndex" v={pnl.rowIndex} p="full" />
          <Row k="rowType" v={pnl.rowType} p={p} />
          <Row k="columnIndex" v={pnl.columnIndex} p="full" />
          <Row k="layout.slot" v={pnl.layout?.slot} p={p} />
          <Row k="slot origin" v={view.slot ? { x: view.slot.x, y: view.slot.y } : undefined} p={p} shown={view.slot ? fmtPoint(view.slot, p) : 'not parsed'} />
          <Row k="layout.signature" v={pnl.layout?.signature} p={p} />
          <Row k="override" v={pnl.override} p={p} />
          <Row k="alignable" v={pnl.alignable} p={p} />
          <Row k="hubScales" v={pnl.hubScales} p={p} />
          <Row k="bounds.width" v={md?.bounds?.width} p={p} />
          <Row k="bounds.height" v={md?.bounds?.height} p={p} />
          <Row k="points (outline)" v={md?.points} p={p} shown={Array.isArray(md?.points) ? `${md.points.length} point(s)` : undefined} />
          <Row k="coordinateSystem" v={md?.coordinateSystem} p={p} />
          <Row k="polygonId" v={md?.polygonId} p={p} />
          <Row k="counts" v={md?.counts} p={p} />
          <Row k="deletedIds" v={pnl.deletedIds} p={p} />
          <Row k="alignedMoves" v={pnl.alignedMoves} p={p} shown={Array.isArray(pnl.alignedMoves) ? `${pnl.alignedMoves.length} item(s)` : undefined} />
        </tbody>
      </table>

      {Array.isArray(md?.points) && (
        <>
          <h3>Outline points ({md.points.length})</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>#</th>
                <th className="num">x</th>
                <th className="num">y</th>
              </tr>
            </thead>
            <tbody>
              {md.points.map((pt, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="num" title={raw(pt?.x)}>{fmt(pt?.x, p)}</td>
                  <td className="num" title={raw(pt?.y)}>{fmt(pt?.y, p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Checks</h3>
      <Issues issues={view.issues} />

      <h3>Grills ({view.grills.length})</h3>
      <table className="grid clickable">
        <thead>
          <tr>
            <th>id</th>
            <th>type</th>
            <th className="num">length</th>
            <th className="num">angle</th>
            <th className="num">notches</th>
          </tr>
        </thead>
        <tbody>
          {view.grills.map((g, gi) => (
            <tr key={gi} className={g.visible === false ? 'faded' : ''} onClick={() => onSelect({ panelKey: view.key, grillIndex: gi })}>
              <td>{fmt(g.id)}</td>
              <td><i className={`sw t-${g.type}`} />{fmt(g.type)}</td>
              <td className="num" title={raw(g.length)}>{fmt(g.length, p)}</td>
              <td className="num" title={raw(g.angle)}>{fmt(g.angle, p)}</td>
              <td className="num">{arr(g.notches).length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Stored lengths</h3>
      <p className="muted small">Grouped by exact stored value. Display aid only, not a BOM.</p>
      <table className="grid">
        <thead>
          <tr>
            <th>type</th>
            <th className="num">length</th>
            <th className="num">qty</th>
          </tr>
        </thead>
        <tbody>
          {[...lengths.values()].map((e, i) => (
            <tr key={i}>
              <td>{fmt(e.type)}</td>
              <td className="num" title={raw(e.length)}>{fmt(e.length, p)}</td>
              <td className="num">{e.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrillDetails({ view, g, gi, related, p, onSelect }: { view: PanelView; g: Grill; gi: number; related: Set<number>; p: Precision; onSelect: Props['onSelect'] }) {
  const indexOf = (id: unknown) => view.grills.findIndex((x) => x.id != null && x.id === id);
  const chip = (id: unknown, suffix?: string, key?: string | number) => {
    const i = indexOf(id);
    return (
      <button
        key={key}
        className={`chip link${i < 0 ? ' missing' : ''}`}
        disabled={i < 0}
        title={i < 0 ? 'Not found in this panel' : 'Select'}
        onClick={() => onSelect({ panelKey: view.key, grillIndex: i })}
      >
        {fmt(id)}
        {suffix ? ` · ${suffix}` : ''}
      </button>
    );
  };
  const notches = arr<Notch>(g.notches);
  const incoming = [...related].filter((oi) => arr<Notch>(view.grills[oi].notches).some((n) => arr<Connection>(n?.connections).some((c) => c?.grillId === g.id)));

  return (
    <div className="details">
      <button className="link back" onClick={() => onSelect({ panelKey: view.key })}>
        ← P{view.index + 1} · {fmt(view.panel.rowType)}
      </button>
      <h2>
        <i className={`sw t-${g.type}`} />
        {g.id ?? `Grill #${gi}`}
      </h2>
      <table className="kv">
        <tbody>
          <Row k="id" v={g.id} p={p} />
          <Row k="type" v={g.type} p={p} />
          <Row k="groupId" v={g.groupId} p={p} />
          <Row k="index / count" v={[g.index, g.count]} p={p} shown={`${fmt(g.index, 'full')} / ${fmt(g.count, 'full')}`} />
          <Row k="source" v={g.source} p={p} />
          <Row k="visible" v={g.visible} p={p} />
          <Row k="selected (stored)" v={g.selected} p={p} />
          <Row k="start (S)" v={g.start} p={p} shown={fmtPoint(g.start, p)} />
          <Row k="end (E)" v={g.end} p={p} shown={fmtPoint(g.end, p)} />
          <Row k="length" v={g.length} p={p} />
          <Row k="angle" v={g.angle} p={p} />
          {g.points !== undefined && <Row k="points" v={g.points} p={p} shown={Array.isArray(g.points) ? `${g.points.length} point(s)` : fmt(g.points)} />}
        </tbody>
      </table>
      <p className="muted small">Coordinates are panel-local (origin at the panel's bottom-left, y up).</p>

      <h3>Notches ({notches.length})</h3>
      {notches.length === 0 ? (
        <p className="muted">None on this grill.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>point</th>
              <th className="num">distance</th>
              <th>connects</th>
            </tr>
          </thead>
          <tbody>
            {notches.map((n, ni) => (
              <tr key={ni}>
                <td>{ni + 1}</td>
                <td title={raw(n?.point)}>{fmtPoint(n?.point, p)}</td>
                <td className="num" title={raw(n?.distance)}>{fmt(n?.distance, p)}</td>
                <td>{arr<Connection>(n?.connections).map((c, ci) => chip(c?.grillId, c?.at, ci))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {incoming.length > 0 && (
        <>
          <h3>Notched into</h3>
          <div className="chips">{incoming.map((oi) => chip(view.grills[oi].id, undefined, oi))}</div>
        </>
      )}

      <h3>Checks</h3>
      <Issues issues={view.issues.filter((i) => i.grillId !== undefined && i.grillId === g.id)} />
    </div>
  );
}
