import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Notch, PanelView, Point, Selection } from './types';
import { arr, dimBox, grillGeometry, isPoint, panelExtent, polylineMidpoint, worldBBox, type Box } from './model';
import { fmt, type Precision } from './format';

export interface ViewOptions {
  notches: boolean;
  labels: boolean;
  dims: boolean;
  grillIds: boolean;
  hiddenGrills: boolean;
}

interface Props {
  views: PanelView[];
  origins: Map<string, Point>;
  options: ViewOptions;
  precision: Precision;
  selection: Selection | null;
  related: Set<number>;
  onSelect(sel: Selection | null): void;
  fitToken: number;
  svgRef: RefObject<SVGSVGElement>;
}

interface VB {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Embedded in the <svg> so an exported file keeps its look. The var() fallbacks
// are the light theme; the app's stylesheet overrides the vars for dark mode.
export const SVG_STYLE = `
.panel-rect { fill: var(--glass, #eaf4fb); stroke: var(--outline, #475569); stroke-width: 1.25px; }
.panel-rect.shape { fill: var(--glass-shape, #f3f0fb); stroke-dasharray: 6 4; }
.panel-rect.shape.outline { stroke-dasharray: none; }
.panel-rect.selected { stroke: var(--accent, #0f766e); stroke-width: 2.5px; }
.grill { fill: none; stroke-width: 2px; stroke-linecap: round; stroke-linejoin: round; }
.grill.t-vertical { stroke: var(--c-vertical, #2563eb); }
.grill.t-horizontal { stroke: var(--c-horizontal, #15803d); }
.grill.t-curved { stroke: var(--c-curved, #c2410c); }
.grill.t-angled { stroke: var(--c-angled, #7e22ce); }
.grill.t-other { stroke: var(--c-other, #64748b); }
.grill.chord { stroke-dasharray: 5 4; }
.grill.is-hidden { opacity: .4; stroke-dasharray: 2 3; }
.grill.related, .grill.hover { stroke-width: 3.5px; }
.grill.selected { stroke: var(--sel, #dc2626); stroke-width: 4.5px; }
.hit { fill: none; stroke: transparent; stroke-width: 12px; cursor: pointer; }
.notch { fill: var(--notch, #ffffff); stroke: var(--notch-stroke, #0f172a); stroke-width: 1px; cursor: pointer; }
.endmark { fill: var(--sel, #dc2626); }
.dim { stroke: var(--dim, #64748b); stroke-width: 1px; fill: none; }
.dim-text, .label, .gid, .endtext { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; pointer-events: none; }
.dim-text { fill: var(--dim, #64748b); }
.label { fill: var(--text, #0f172a); font-weight: 600; }
.gid { fill: var(--text-2, #334155); }
.label, .gid, .endtext { paint-order: stroke; stroke: var(--halo, #ffffff); stroke-width: 3px; stroke-linejoin: round; }
.endtext { fill: var(--sel, #dc2626); font-weight: 700; }
.panel-rect, .grill, .hit, .notch, .dim, .label, .gid, .endtext { vector-effect: non-scaling-stroke; }
`;

const KNOWN_TYPES = new Set(['vertical', 'horizontal', 'curved', 'angled']);
const typeClass = (t: unknown) => (typeof t === 'string' && KNOWN_TYPES.has(t) ? t : 'other');

export function GrillCanvas({ views, origins, options, precision, selection, related, onSelect, fitToken, svgRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [vb, setVb] = useState<VB>({ x: 0, y: -75, w: 100, h: 75 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [hover, setHover] = useState<{ panelKey: string; grillIndex: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ sx: number; sy: number; vb: VB; moved: boolean; target: Element } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep scale and centre when the canvas is resized.
  const prevSize = useRef(size);
  useEffect(() => {
    const p = prevSize.current;
    prevSize.current = size;
    if (p.w === size.w && p.h === size.h) return;
    setVb((v) => {
      const k = v.w / p.w;
      const w = size.w * k;
      const h = size.h * k;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });
  }, [size]);

  const bbox = useMemo(() => worldBBox(views, origins), [views, origins]);

  const fit = useCallback(() => {
    if (!bbox) return;
    const { w: cw, h: ch } = sizeRef.current;
    const margin = 48; // px reserved for dimension text
    const bw = Math.max(bbox.maxX - bbox.minX, 1e-6);
    const bh = Math.max(bbox.maxY - bbox.minY, 1e-6);
    const k = Math.max(bw / Math.max(cw - 2 * margin, 50), bh / Math.max(ch - 2 * margin, 50));
    const w = cw * k;
    const h = ch * k;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = -(bbox.minY + bbox.maxY) / 2;
    setVb({ x: cx - w / 2, y: cy - h / 2, w, h });
  }, [bbox]);

  useLayoutEffect(() => {
    fit();
    // Only refit on explicit requests (load, layout change, "Fit"), not on every hide/show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const k = Math.exp(e.deltaY * 0.0015);
      setVb((v) => {
        const px = v.x + fx * v.w;
        const py = v.y + fy * v.h;
        const w = v.w * k;
        const h = v.h * k;
        return { x: px - fx * w, y: py - fy * h, w, h };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef]);

  const toWorld = (e: { clientX: number; clientY: number }): Point | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: vb.x + ((e.clientX - r.left) / r.width) * vb.w, y: -(vb.y + ((e.clientY - r.top) / r.height) * vb.h) };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vb, moved: false, target: e.target as Element };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    setCursor(toWorld(e));
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      setHover(null);
    }
    const k = d.vb.w / e.currentTarget.getBoundingClientRect().width;
    setVb({ ...d.vb, x: d.vb.x - dx * k, y: d.vb.y - dy * k });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d || d.moved) return;
    const grillEl = d.target.closest('[data-grill]');
    const panelEl = d.target.closest('[data-panel]');
    const panelKey = panelEl?.getAttribute('data-panel');
    if (panelKey == null) onSelect(null);
    else if (grillEl) onSelect({ panelKey, grillIndex: Number(grillEl.getAttribute('data-grill')) });
    else onSelect({ panelKey });
  };

  const onPointerOver = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.moved) return;
    const t = e.target as Element;
    const grillEl = t.closest('[data-grill]');
    const panelKey = t.closest('[data-panel]')?.getAttribute('data-panel');
    setHover(grillEl && panelKey != null ? { panelKey, grillIndex: Number(grillEl.getAttribute('data-grill')) } : null);
  };

  const ppx = vb.w / size.w; // world units per screen pixel
  const fs = 11 * ppx;

  const renderPanel = (v: PanelView) => {
    const o = origins.get(v.key);
    if (!o) return null;
    const X = (x: number) => o.x + x;
    const Y = (y: number) => -(o.y + y);
    const isSelPanel = selection?.panelKey === v.key;
    const shape = v.panel.override != null || v.panel.rowType === 'shape';
    const ext = panelExtent(v);
    const box = dimBox(v);
    const shown = (gi: number) => v.grills[gi].visible !== false || options.hiddenGrills;

    // Draw the selected grill last so it sits on top.
    const order = v.grills.map((_, gi) => gi).filter(shown);
    if (isSelPanel && selection?.grillIndex !== undefined) {
      const at = order.indexOf(selection.grillIndex);
      if (at >= 0) order.push(...order.splice(at, 1));
    }
    const selGeo = isSelPanel && selection?.grillIndex !== undefined ? grillGeometry(v.grills[selection.grillIndex] ?? {}) : null;
    const overrideType = v.panel.override && typeof v.panel.override === 'object' ? (v.panel.override as { type?: unknown }).type : undefined;

    return (
      <g key={v.key} data-panel={v.key}>
        {/* The stored outline is the true shape, so it is drawn solid; bounds alone stay dashed for shapes. */}
        {v.outline ? (
          <polygon
            className={`panel-rect${shape ? ' shape outline' : ''}${isSelPanel ? ' selected' : ''}`}
            points={v.outline.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
          />
        ) : v.bounds && (
          <rect
            className={`panel-rect${shape ? ' shape' : ''}${isSelPanel ? ' selected' : ''}`}
            x={X(0)}
            y={Y(v.bounds.height)}
            width={v.bounds.width}
            height={v.bounds.height}
          />
        )}

        {order.map((gi) => {
          const g = v.grills[gi];
          const geo = grillGeometry(g);
          if (!geo) return null;
          const pts = geo.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
          const cls = [
            'grill',
            `t-${typeClass(g.type)}`,
            geo.chord && 'chord',
            g.visible === false && 'is-hidden',
            isSelPanel && related.has(gi) && 'related',
            hover?.panelKey === v.key && hover.grillIndex === gi && 'hover',
            isSelPanel && selection?.grillIndex === gi && 'selected',
          ].filter(Boolean).join(' ');
          return (
            <g key={gi} data-grill={gi}>
              <polyline className={cls} points={pts} />
              <polyline className="hit" points={pts} />
            </g>
          );
        })}

        {options.notches &&
          order.flatMap((gi) =>
            arr<Notch>(v.grills[gi].notches).map((n, ni) =>
              isPoint(n?.point) ? (
                <circle key={`n${gi}-${ni}`} data-grill={gi} className="notch" cx={X(n.point.x)} cy={Y(n.point.y)} r={3.2 * ppx} />
              ) : null,
            ),
          )}

        {selGeo && (
          <g>
            <rect className="endmark" x={X(selGeo.pts[0].x) - 3.5 * ppx} y={Y(selGeo.pts[0].y) - 3.5 * ppx} width={7 * ppx} height={7 * ppx} />
            <circle className="endmark" cx={X(selGeo.pts[selGeo.pts.length - 1].x)} cy={Y(selGeo.pts[selGeo.pts.length - 1].y)} r={3.5 * ppx} />
            <text className="endtext" x={X(selGeo.pts[0].x) + 6 * ppx} y={Y(selGeo.pts[0].y) - 6 * ppx} fontSize={fs}>S</text>
            <text className="endtext" x={X(selGeo.pts[selGeo.pts.length - 1].x) + 6 * ppx} y={Y(selGeo.pts[selGeo.pts.length - 1].y) - 6 * ppx} fontSize={fs}>E</text>
          </g>
        )}

        {options.grillIds &&
          order.map((gi) => {
            const geo = grillGeometry(v.grills[gi]);
            if (!geo) return null;
            const m = polylineMidpoint(geo.pts);
            return (
              <text key={`id${gi}`} className="gid" x={X(m.x) + 3 * ppx} y={Y(m.y) - 3 * ppx} fontSize={fs * 0.9}>
                {fmt(v.grills[gi].id)}
              </text>
            );
          })}

        {options.labels && (() => {
          const full = `P${v.index + 1} · ${v.panel.rowType ?? 'panel'} · r${v.panel.rowIndex ?? '?'} c${v.panel.columnIndex ?? '?'}` +
            (overrideType !== undefined ? ` · ${String(overrideType)}` : '');
          // Narrow panels get the short name; the full description is in the sidebar and details.
          const text = full.length * fs * 0.58 + 8 * ppx > ext.width ? `P${v.index + 1}` : full;
          return (
            <text className="label" x={X(0) + 4 * ppx} y={Y(ext.height) + fs + 3 * ppx} fontSize={fs}>
              {text}
            </text>
          );
        })()}

        {options.dims && box && renderDims(X, Y, box, widthDimBelow(v, o, box))}
      </g>
    );
  };

  // The width dimension goes below the panel unless another drawn panel occupies that
  // strip (e.g. a shape sitting on a transom); then it goes above, if that strip is free.
  const widthDimBelow = (v: PanelView, o: Point, b: Box) => {
    const band = (16 + 11 + 6) * ppx;
    const blocked = (y0: number, y1: number) =>
      views.some((u) => {
        if (u.key === v.key) return false;
        const uo = origins.get(u.key);
        if (!uo) return false;
        const e = panelExtent(u);
        return uo.x < o.x + b.x1 && uo.x + e.width > o.x + b.x0 && uo.y < y1 && uo.y + e.height > y0;
      });
    return !blocked(o.y + b.y0 - band, o.y + b.y0) || blocked(o.y + b.y1, o.y + b.y1 + band);
  };

  // Width and height of the box: stored bounds, or the stored outline's extent when there are no bounds.
  const renderDims = (X: (x: number) => number, Y: (y: number) => number, b: Box, below: boolean) => {
    const off = 16 * ppx;
    const t = 4 * ppx;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const yb = below ? Y(b.y0) + off : Y(b.y1) - off;
    const xl = X(b.x0) - off;
    const ym = Y((b.y0 + b.y1) / 2);
    return (
      <g>
        <line className="dim" x1={X(b.x0)} y1={yb} x2={X(b.x1)} y2={yb} />
        <line className="dim" x1={X(b.x0)} y1={yb - t} x2={X(b.x0)} y2={yb + t} />
        <line className="dim" x1={X(b.x1)} y1={yb - t} x2={X(b.x1)} y2={yb + t} />
        <text className="dim-text" x={X((b.x0 + b.x1) / 2)} y={below ? yb + fs + 2 * ppx : yb - 4 * ppx} fontSize={fs} textAnchor="middle">
          {fmt(w, precision)}
        </text>
        <line className="dim" x1={xl} y1={Y(b.y0)} x2={xl} y2={Y(b.y1)} />
        <line className="dim" x1={xl - t} y1={Y(b.y0)} x2={xl + t} y2={Y(b.y0)} />
        <line className="dim" x1={xl - t} y1={Y(b.y1)} x2={xl + t} y2={Y(b.y1)} />
        <text className="dim-text" x={xl - 4 * ppx} y={ym} fontSize={fs} textAnchor="middle" transform={`rotate(-90 ${xl - 4 * ppx} ${ym})`}>
          {fmt(h, precision)}
        </text>
      </g>
    );
  };

  // Status bar: cursor in world and panel-local coordinates, hovered grill.
  const under = cursor
    ? views.find((v) => {
        const o = origins.get(v.key);
        if (!o) return false;
        const e = panelExtent(v);
        return cursor.x >= o.x && cursor.x <= o.x + e.width && cursor.y >= o.y && cursor.y <= o.y + e.height;
      })
    : undefined;
  const underOrigin = under ? origins.get(under.key) : undefined;
  const hovGrill = hover ? views.find((v) => v.key === hover.panelKey)?.grills[hover.grillIndex] : undefined;

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`canvas${panning ? ' panning' : ''}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerOver={onPointerOver}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
        }}
      >
        <style>{SVG_STYLE}</style>
        {views.map(renderPanel)}
      </svg>

      {views.length === 0 && (
        <div className="empty">
          <p>No panels to draw.</p>
          <p className="muted">Paste grill JSON on the left, upload a .json file, or drop one anywhere on the page.</p>
        </div>
      )}

      <div className="legend">
        <span><i className="sw t-vertical" />vertical</span>
        <span><i className="sw t-horizontal" />horizontal</span>
        <span><i className="sw t-curved" />curved</span>
        <span><i className="sw t-angled" />angled</span>
        <span><i className="dot" />notch</span>
      </div>

      <div className="status">
        {cursor ? (
          <>
            <span>x {fmt(cursor.x, precision)} · y {fmt(cursor.y, precision)}</span>
            {under && underOrigin && (
              <span>
                P{under.index + 1} local ({fmt(cursor.x - underOrigin.x, precision)}, {fmt(cursor.y - underOrigin.y, precision)})
              </span>
            )}
            {hovGrill && (
              <span>
                {fmt(hovGrill.id)} · {fmt(hovGrill.type)} · L {fmt(hovGrill.length, precision)}
              </span>
            )}
          </>
        ) : (
          <span className="muted">Drag to pan · scroll to zoom · F to fit · Esc to clear</span>
        )}
      </div>
    </div>
  );
}
