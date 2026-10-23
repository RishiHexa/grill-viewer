import { useMemo, useRef, useState } from 'react';
import type { Issue, PanelView, Point, Selection, Severity } from './types';
import { fmt, type Precision } from './format';
import { pointsBox } from './model';

const outlineSize = (pts: Point[], p: Precision) => {
  const b = pointsBox(pts);
  return `${fmt(b.x1 - b.x0, p)} × ${fmt(b.y1 - b.y0, p)}`;
};

interface Props {
  text: string;
  onText(t: string): void;
  onVisualize(): void;
  onFile(f: File): void;
  onSample(): void;
  onClear(): void;
  error: string | null;
  source: string | null;
  views: PanelView[];
  hidden: Set<string>;
  onToggle(key: string): void;
  selection: Selection | null;
  onSelect(sel: Selection | null): void;
  precision: Precision;
}

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];

export function Sidebar(props: Props) {
  const { text, onText, onVisualize, onFile, onSample, onClear, error, source, views, hidden, onToggle, selection, onSelect, precision } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [sevShown, setSevShown] = useState<Set<Severity>>(new Set(['error', 'warning']));

  const allIssues = useMemo(() => views.flatMap((v) => v.issues), [views]);
  const sevCount = (s: Severity) => allIssues.filter((i) => i.severity === s).length;
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of views) for (const g of v.grills) m.set(String(g.type ?? '(no type)'), (m.get(String(g.type ?? '(no type)')) ?? 0) + 1);
    return [...m];
  }, [views]);

  const selectIssue = (i: Issue) => {
    const v = views[i.panelIndex];
    if (!v) return;
    const gi = i.grillId !== undefined ? v.grills.findIndex((g) => g.id === i.grillId) : -1;
    onSelect(gi >= 0 ? { panelKey: v.key, grillIndex: gi } : { panelKey: v.key });
  };

  return (
    <aside className="sidebar">
      <section>
        <h3>Data</h3>
        <textarea
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="Paste the grill JSON array here…"
          spellCheck={false}
          rows={7}
        />
        <div className="btns">
          <button className="primary" onClick={onVisualize}>Visualize</button>
          <button onClick={() => fileRef.current?.click()}>Upload…</button>
          <button onClick={onSample}>Sample</button>
          <button onClick={onClear}>Clear</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        {error && <p className="error">{error}</p>}
        {source && !error && (
          <p className="muted small">
            Loaded <b>{source}</b>: {views.length} panel(s), {views.reduce((n, v) => n + v.grills.length, 0)} grill(s)
            {totals.length > 0 && <> — {totals.map(([t, n]) => `${n} ${t}`).join(', ')}</>}
          </p>
        )}
      </section>

      {views.length > 0 && (
        <section>
          <h3>Panels</h3>
          <ul className="panels">
            {views.map((v) => {
              const errs = v.issues.filter((i) => i.severity === 'error').length;
              const warns = v.issues.filter((i) => i.severity === 'warning').length;
              return (
                <li key={v.key} className={selection?.panelKey === v.key ? 'active' : ''}>
                  <input type="checkbox" checked={!hidden.has(v.key)} onChange={() => onToggle(v.key)} title="Show in drawing" />
                  <button className="link" onClick={() => onSelect({ panelKey: v.key })}>
                    <b>P{v.index + 1}</b> {fmt(v.panel.rowType)} <span className="muted">r{fmt(v.panel.rowIndex, 'full')} c{fmt(v.panel.columnIndex, 'full')}</span>
                    <br />
                    <span className="muted small">
                      {v.bounds
                        ? `${fmt(v.bounds.width, precision)} × ${fmt(v.bounds.height, precision)}`
                        : v.outline
                          ? `${outlineSize(v.outline, precision)} outline`
                          : 'no bounds'}
                      {v.outline && v.bounds && ' · outline'} · {v.grills.length} grills
                    </span>
                  </button>
                  {errs > 0 && <span className="badge sev-error">{errs}</span>}
                  {warns > 0 && <span className="badge sev-warning">{warns}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {views.length > 0 && (
        <section>
          <h3>Checks</h3>
          <div className="filters">
            {SEVERITIES.map((s) => (
              <label key={s} className={`sev-${s}`}>
                <input
                  type="checkbox"
                  checked={sevShown.has(s)}
                  onChange={() => {
                    const n = new Set(sevShown);
                    if (n.has(s)) n.delete(s);
                    else n.add(s);
                    setSevShown(n);
                  }}
                />
                {s} ({sevCount(s)})
              </label>
            ))}
          </div>
          {allIssues.length === 0 ? (
            <p className="ok">No issues found by the checks.</p>
          ) : (
            <ul className="issues">
              {allIssues
                .filter((i) => sevShown.has(i.severity))
                .map((i, n) => (
                  <li key={n} className={`sev-${i.severity}`} onClick={() => selectIssue(i)}>
                    <span className="sev">{i.severity}</span>
                    <b>P{i.panelIndex + 1}{i.grillId ? ` ${i.grillId}` : ''}</b> {i.message}
                  </li>
                ))}
            </ul>
          )}
          <p className="muted small">Checks are read-only consistency tests on the stored data; nothing is corrected.</p>
        </section>
      )}
    </aside>
  );
}
