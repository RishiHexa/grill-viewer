import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import sample from './sample.json';
import { buildViews, computeOrigins, parseInput, relatedGrills } from './model';
import { GrillCanvas, type ViewOptions } from './GrillCanvas';
import { Details } from './Details';
import { Sidebar } from './Sidebar';
import { exportCsv, exportSvg } from './exporters';
import type { LayoutMode, Panel, Selection } from './types';
import type { Precision } from './format';

const OPTION_LABELS: [keyof ViewOptions, string][] = [
  ['notches', 'Notches'],
  ['dims', 'Dimensions'],
  ['labels', 'Panel labels'],
  ['grillIds', 'Grill ids'],
  ['hiddenGrills', 'Hidden grills'],
];

export default function App() {
  const [text, setText] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<LayoutMode>('assembled');
  const [options, setOptions] = useState<ViewOptions>({ notches: true, labels: true, dims: true, grillIds: false, hiddenGrills: false });
  const [precision, setPrecision] = useState<Precision>(3);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const views = useMemo(() => (panels ? buildViews(panels) : []), [panels]);
  const shown = useMemo(() => views.filter((v) => !hidden.has(v.key)), [views, hidden]);
  const origins = useMemo(() => computeOrigins(shown, mode), [shown, mode]);

  const selView = views.find((v) => v.key === selection?.panelKey) ?? null;
  const related = useMemo(
    () => (selView && selection?.grillIndex !== undefined ? relatedGrills(selView, selection.grillIndex) : new Set<number>()),
    [selView, selection],
  );

  const load = useCallback((raw: string, name: string) => {
    try {
      const p = parseInput(raw);
      setPanels(p);
      setError(null);
      setSource(name);
      setHidden(new Set());
      setSelection(null);
      setFitToken((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadFile = useCallback(
    async (f: File) => {
      const content = await f.text();
      setText(content);
      load(content, f.name);
    },
    [load],
  );

  const loadSample = useCallback(() => {
    const s = JSON.stringify(sample, null, 2);
    setText(s);
    load(s, 'sample (gothic panel truncated)');
  }, [load]);

  // ?sample opens the viewer with the bundled sample loaded.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('sample')) loadSample();
  }, [loadSample]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, select')) return;
      if (e.key === 'Escape') setSelection(null);
      if (e.key === 'f' || e.key === 'F') setFitToken((n) => n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const baseName = (source ?? 'grills').replace(/\.[^.]+$/, '');

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void loadFile(f);
      }}
    >
      <header className="topbar">
        <h1>Grill Viewer</h1>
        <div className="seg" role="group" aria-label="Layout">
          <button
            className={mode === 'assembled' ? 'on' : ''}
            title="Each panel placed at its layout.slot x,y (taken as bottom-left offset, y up)"
            onClick={() => {
              setMode('assembled');
              setFitToken((t) => t + 1);
            }}
          >
            Assembled
          </button>
          <button
            className={mode === 'separate' ? 'on' : ''}
            title="Panels side by side in input order"
            onClick={() => {
              setMode('separate');
              setFitToken((t) => t + 1);
            }}
          >
            Separate
          </button>
        </div>
        <div className="toggles">
          {OPTION_LABELS.map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={options[k]} onChange={() => setOptions((o) => ({ ...o, [k]: !o[k] }))} />
              {label}
            </label>
          ))}
        </div>
        <label className="prec">
          Precision
          <select
            value={String(precision)}
            onChange={(e) => setPrecision(e.target.value === 'full' ? 'full' : (Number(e.target.value) as Precision))}
          >
            <option value="2">2 dp</option>
            <option value="3">3 dp</option>
            <option value="4">4 dp</option>
            <option value="6">6 dp</option>
            <option value="full">full</option>
          </select>
        </label>
        <div className="btns">
          <button onClick={() => setFitToken((t) => t + 1)}>Fit</button>
          <button disabled={!shown.length} onClick={() => svgRef.current && exportSvg(svgRef.current, `${baseName}.svg`)}>
            SVG
          </button>
          <button disabled={!views.length} onClick={() => exportCsv(views, `${baseName}-grills.csv`)}>
            CSV
          </button>
        </div>
      </header>

      <Sidebar
        text={text}
        onText={setText}
        onVisualize={() => load(text, 'pasted JSON')}
        onFile={(f) => void loadFile(f)}
        onSample={loadSample}
        onClear={() => {
          setText('');
          setPanels(null);
          setSource(null);
          setError(null);
          setSelection(null);
        }}
        error={error}
        source={source}
        views={views}
        hidden={hidden}
        onToggle={(key) =>
          setHidden((h) => {
            const n = new Set(h);
            if (n.has(key)) n.delete(key);
            else n.add(key);
            return n;
          })
        }
        selection={selection}
        onSelect={setSelection}
        precision={precision}
      />

      <main className="main">
        <GrillCanvas
          views={shown}
          origins={origins}
          options={options}
          precision={precision}
          selection={selection}
          related={related}
          onSelect={setSelection}
          fitToken={fitToken}
          svgRef={svgRef}
        />
      </main>

      <aside className="right">
        <Details view={selView} grillIndex={selection?.grillIndex} related={related} precision={precision} onSelect={setSelection} />
      </aside>

      {dragOver && <div className="drop">Drop a JSON file to load it</div>}
    </div>
  );
}
