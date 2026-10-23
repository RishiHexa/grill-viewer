import type {
  Bounds,
  Connection,
  Grill,
  Issue,
  LayoutMode,
  Notch,
  Panel,
  PanelMetadata,
  PanelView,
  Point,
  Severity,
  Slot,
  ThreeDGrills,
} from './types';
import { raw } from './format';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isPoint = (p: unknown): p is Point =>
  !!p && typeof p === 'object' && isNum((p as Point).x) && isNum((p as Point).y);

export const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Tolerances below are for consistency checks only. They never alter a value.
const POS_TOL = 1e-6; // bounds containment
// Outline containment. Curved outline edges are stored as sampled points, so a grill end on the
// true curve can sit a little outside the sampled chord.
const OUTLINE_TOL = 1e-3;
const JOIN_TOL = 1e-4; // notch point vs connected grill endpoint
const STRAIGHT_LEN_TOL = 1e-6; // stored length vs endpoint distance

const r4 = (n: number) => String(+n.toFixed(4));
const pt4 = (p: Point) => `(${r4(p.x)}, ${r4(p.y)})`;

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

export function parseInput(text: string): Panel[] {
  if (!text.trim()) throw new Error('Nothing to parse — paste the grill JSON first.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  return extractPanels(data);
}

/**
 * Accepts: an array of panels, an object wrapping one ({ panels | polygons | items | data: [...] }),
 * a single panel, a bare metadata object ({ polygonId, bounds, grills }), a sealed-unit record with a
 * `threeDGrills` block (or the bare block), or a JSON-encoded string of any of these.
 */
export function extractPanels(data: unknown): Panel[] {
  if (typeof data === 'string') return parseInput(data);
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error('The array is empty.');
    return data.map((item, i) => {
      if (!isObj(item)) throw new Error(`Item ${i} is not an object.`);
      return asPanel(item);
    });
  }
  if (isObj(data)) {
    if ('threeDGrills' in data) return [asPanel(data)];
    for (const k of ['panels', 'polygons', 'items', 'data']) {
      if (Array.isArray(data[k])) return extractPanels(data[k]);
    }
    return [asPanel(data)];
  }
  throw new Error('Expected an array of panel objects.');
}

function asPanel(o: Record<string, unknown>): Panel {
  if ('threeDGrills' in o) {
    let t = o.threeDGrills;
    if (typeof t === 'string') {
      try {
        t = JSON.parse(t);
      } catch (e) {
        throw new Error(`threeDGrills is a string but not valid JSON: ${(e as Error).message}`);
      }
    }
    if (!isObj(t)) throw new Error('threeDGrills is not an object.');
    return fromThreeDGrills(t as ThreeDGrills);
  }
  if (!('metadata' in o) && Array.isArray(o.grills)) {
    // A bare threeDGrills block carries v / signature, which a bare metadata object does not.
    if ('v' in o || 'signature' in o) return fromThreeDGrills(o as ThreeDGrills);
    return { id: o.polygonId as string | undefined, metadata: o as PanelMetadata };
  }
  return o as Panel;
}

// Only the threeDGrills block is read; the surrounding sealed-unit fields are not interpreted.
function fromThreeDGrills(t: ThreeDGrills): Panel {
  return {
    override: t.override,
    deletedIds: t.deletedIds,
    layout: t.signature !== undefined ? { signature: t.signature } : undefined,
    metadata: { points: t.points, grills: t.grills },
    format: { kind: 'threeDGrills', v: t.v },
  };
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const SLOT_RE = new RegExp(String.raw`^\s*(${NUM})\s*:\s*(${NUM})\s*:\s*(${NUM})\s*,\s*(${NUM})\s*$`);

/** "row:col:x,y" → Slot. x,y are taken as the panel's bottom-left offset (y up). */
export function parseSlot(slot: unknown): Slot | null {
  if (typeof slot !== 'string') return null;
  const m = SLOT_RE.exec(slot);
  if (!m) return null;
  const [row, col, x, y] = m.slice(1).map(Number);
  return [row, col, x, y].every(Number.isFinite) ? { row, col, x, y } : null;
}

// ---------------------------------------------------------------------------
// Geometry (drawing only)
// ---------------------------------------------------------------------------

export interface GrillGeometry {
  pts: Point[];
  /** true when a curved grill had no usable points[] and is drawn start→end. */
  chord: boolean;
}

export function grillGeometry(g: Grill): GrillGeometry | null {
  if (Array.isArray(g.points) && g.points.length >= 2 && g.points.every(isPoint)) return { pts: g.points, chord: false };
  if (isPoint(g.start) && isPoint(g.end)) return { pts: [g.start, g.end], chord: g.type === 'curved' };
  return null;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function polylineLength(pts: Point[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Point halfway along the drawn polyline — used to place labels. */
export function polylineMidpoint(pts: Point[]): Point {
  const half = polylineLength(pts) / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= half && d > 0) {
      const t = (half - acc) / d;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += d;
  }
  return pts[0];
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function pointsBox(pts: Point[]): Box {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Panel-local box the dimensions are drawn for: stored bounds, else the stored outline's extent. */
export function dimBox(v: PanelView): Box | null {
  if (v.bounds) return { x0: 0, y0: 0, x1: v.bounds.width, y1: v.bounds.height };
  return v.outline ? pointsBox(v.outline) : null;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Inside the closed polygon, or within tol of its edge. */
export function inPolygon(p: Point, poly: Point[], tol: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (distToSegment(p, a, b) <= tol) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(s) / 2;
}

/** Grills joined to grills[gi] through notch connections, in either direction. */
export function relatedGrills(view: PanelView, gi: number): Set<number> {
  const out = new Set<number>();
  const g = view.grills[gi];
  if (!g) return out;
  const targets = new Set<string>();
  for (const n of arr<Notch>(g.notches)) for (const c of arr<Connection>(n?.connections)) if (c?.grillId != null) targets.add(String(c.grillId));
  view.grills.forEach((o, oi) => {
    if (oi === gi) return;
    if (o.id != null && targets.has(String(o.id))) out.add(oi);
    if (g.id != null && arr<Notch>(o.notches).some((n) => arr<Connection>(n?.connections).some((c) => c?.grillId === g.id))) out.add(oi);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Views + validation
// ---------------------------------------------------------------------------

type Add = (severity: Severity, message: string, grillId?: string) => void;

export function buildViews(panels: Panel[]): PanelView[] {
  const idCounts = new Map<string, number>();
  for (const p of panels) if (p.id != null) idCounts.set(String(p.id), (idCounts.get(String(p.id)) ?? 0) + 1);

  return panels.map((panel, index) => {
    const issues: Issue[] = [];
    const add: Add = (severity, message, grillId) => issues.push({ severity, panelIndex: index, grillId, message });

    // A threeDGrills block has no panel id, bounds or slot, so their absence is expected there.
    const threeD = panel.format?.kind === 'threeDGrills';
    const src = threeD ? 'threeDGrills' : 'metadata';
    if (threeD && panel.format?.v !== 1) add('warning', `threeDGrills.v is ${raw(panel.format?.v)}; this viewer reads v 1.`);

    const noId = panel.id == null || panel.id === '';
    if (noId && !threeD) add('warning', 'Panel has no id.');
    else if (!noId && (idCounts.get(String(panel.id)) ?? 0) > 1) add('warning', `Panel id ${panel.id} appears more than once in the input.`);

    const md = isObj(panel.metadata) ? (panel.metadata as PanelMetadata) : undefined;
    if (!md) add('error', 'Panel has no metadata object; nothing to draw.');

    const b = md?.bounds;
    const bounds: Bounds | null = b && isNum(b.width) && isNum(b.height) ? { width: b.width, height: b.height } : null;

    const rawOutline = md?.points;
    const outline = Array.isArray(rawOutline) && rawOutline.length >= 3 && rawOutline.every(isPoint) ? rawOutline : null;
    if (rawOutline !== undefined && !outline)
      add('error', `${src}.points is not a list of at least 3 numeric points; outline not drawn from it.`);
    if (outline) {
      if (polygonArea(outline) <= POS_TOL) add('warning', `${src}.points encloses no area.`);
      if (bounds && outline.some((p) => p.x < -POS_TOL || p.y < -POS_TOL || p.x > bounds.width + POS_TOL || p.y > bounds.height + POS_TOL))
        add('warning', `${src}.points extends outside metadata.bounds.`);
    }
    if (md && !bounds && !outline && !(threeD && rawOutline !== undefined))
      add('error', threeD
        ? 'threeDGrills.points is missing; panel outline not drawn.'
        : 'metadata.bounds is missing or not numeric; panel outline not drawn.');
    if (md?.coordinateSystem !== undefined && md.coordinateSystem !== 'polygon-local')
      add('warning', `Unexpected coordinateSystem "${md.coordinateSystem}"; drawn as polygon-local.`);
    if (md?.polygonId !== undefined && panel.id !== undefined && md.polygonId !== panel.id)
      add('warning', `metadata.polygonId (${md.polygonId}) differs from panel id.`);

    const slotRaw = panel.layout?.slot;
    const slot = parseSlot(slotRaw);
    if (!slot) {
      add(threeD ? 'info' : 'warning', slotRaw == null
        ? 'layout.slot is missing; panel is placed beside the assembly instead of at its position.'
        : `layout.slot "${slotRaw}" is not in "row:col:x,y" form; panel is placed beside the assembly.`);
    } else {
      if (isNum(panel.rowIndex) && slot.row !== panel.rowIndex) add('warning', `layout.slot row ${slot.row} ≠ rowIndex ${panel.rowIndex}.`);
      if (isNum(panel.columnIndex) && slot.col !== panel.columnIndex) add('warning', `layout.slot column ${slot.col} ≠ columnIndex ${panel.columnIndex}.`);
    }

    const rawGrills = md ? md.grills : undefined;
    if (md && !Array.isArray(rawGrills)) add('warning', `${src}.grills is missing or not an array.`);
    const grills: Grill[] = [];
    arr<unknown>(rawGrills).forEach((g, gi) => {
      if (isObj(g)) grills.push(g as Grill);
      else add('error', `${src}.grills[${gi}] is not an object; skipped.`);
    });
    validateGrills(grills, bounds, outline, md?.counts, add);

    const deleted = arr<unknown>(panel.deletedIds);
    if (deleted.length) add('info', `${deleted.length} deleted grill id(s): ${deleted.map(String).join(', ')}.`);

    return { key: `${index}:${panel.id ?? ''}`, index, panel, slot, bounds, outline, grills, issues };
  });
}

function validateGrills(grills: Grill[], bounds: Bounds | null, outline: Point[] | null, counts: unknown, add: Add) {
  const byId = new Map<string, Grill>();
  const idCount = new Map<string, number>();
  for (const g of grills) {
    if (g.id == null) continue;
    const id = String(g.id);
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
    if (!byId.has(id)) byId.set(id, g);
  }
  for (const [id, n] of idCount) if (n > 1) add('warning', `Grill id "${id}" appears ${n} times; connections to it are ambiguous.`, id);

  const hidden: string[] = [];
  grills.forEach((g, gi) => {
    const id = g.id != null ? String(g.id) : undefined;
    if (id === undefined) add('warning', `Grill #${gi} has no id.`);

    const geo = grillGeometry(g);
    const hasEnds = isPoint(g.start) && isPoint(g.end);
    if (!geo) add('error', 'No numeric start/end or points[]; grill not drawn.', id);
    else if (!hasEnds) add('warning', 'start/end missing or not numeric (drawn from points[]).', id);
    if (g.points !== undefined && !(Array.isArray(g.points) && g.points.every(isPoint)))
      add('warning', 'points[] is not a list of numeric points; ignored.', id);
    if (geo?.chord) add('warning', 'Curved grill has no usable points[]; drawn as a dashed straight chord.', id);

    // The outline is the true panel shape, so it takes precedence over the bounds rectangle.
    // Only stored points are tested; a straight grill could still cross a concave notch between them.
    if (geo && outline) {
      if (geo.pts.some((p) => !inPolygon(p, outline, OUTLINE_TOL)))
        add('warning', `Geometry extends outside the panel outline (points, tolerance ${OUTLINE_TOL}).`, id);
    } else if (geo && bounds && geo.pts.some((p) => p.x < -POS_TOL || p.y < -POS_TOL || p.x > bounds.width + POS_TOL || p.y > bounds.height + POS_TOL))
      add('warning', 'Geometry extends outside the panel bounds.', id);

    if (!isNum(g.length)) add('warning', 'length is missing or not numeric.', id);
    else if (geo && !geo.chord) {
      const drawn = polylineLength(geo.pts);
      // Curves are sampled polylines, so only a gross difference (>0.5%) is reported.
      const tol = geo.pts.length > 2 ? Math.max(1e-3, Math.abs(g.length) * 0.005) : STRAIGHT_LEN_TOL;
      if (Math.abs(drawn - g.length) > tol)
        add('info', `Stored length ${r4(g.length)} differs from drawn geometry ${r4(drawn)}. Check only — the stored length is what is displayed.`, id);
    }

    if (g.visible === false) hidden.push(id ?? `#${gi}`);

    arr<Notch>(g.notches).forEach((n, ni) => {
      const np = n?.point;
      if (!isPoint(np)) add('warning', `Notch ${ni + 1} has no numeric point.`, id);
      for (const c of arr<Connection>(n?.connections)) {
        if (c?.grillId == null) {
          add('warning', `Notch ${ni + 1} has a connection without grillId.`, id);
          continue;
        }
        const target = byId.get(String(c.grillId));
        if (!target) {
          add('warning', `Notch ${ni + 1} connects to "${c.grillId}", which is not in this panel.`, id);
          continue;
        }
        if (isPoint(np) && (c.at === 'start' || c.at === 'end')) {
          const tp = target[c.at];
          if (isPoint(tp) && dist(tp, np) > JOIN_TOL)
            add('warning', `Notch ${ni + 1} says ${c.grillId}.${c.at} meets here ${pt4(np)}, but ${c.grillId}.${c.at} is ${pt4(tp)}.`, id);
        }
      }
    });
  });
  if (hidden.length) add('info', `${hidden.length} grill(s) stored with visible:false: ${hidden.join(', ')}.`);

  const groups = new Map<string, Grill[]>();
  for (const g of grills) {
    const k = String(g.groupId ?? g.type ?? '?');
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  for (const [k, list] of groups) {
    for (const d of new Set(list.map((g) => g.count).filter(isNum)))
      if (d !== list.length) add('warning', `Group "${k}": grills declare count ${d} but ${list.length} are present.`);
  }

  if (isObj(counts)) {
    for (const [type, v] of Object.entries(counts)) {
      const actual = grills.filter((g) => g.type === type).length;
      if (isNum(v) && v !== actual) add('warning', `metadata.counts.${type} = ${v} but ${actual} ${type} grill(s) are present.`);
    }
    const types = new Map<string, number>();
    for (const g of grills) if (g.type != null) types.set(g.type, (types.get(g.type) ?? 0) + 1);
    for (const [t, n] of types) if (!(t in counts)) add('info', `${n} "${t}" grill(s) not listed in metadata.counts.`);
  }
}

// ---------------------------------------------------------------------------
// Layout (drawing only)
// ---------------------------------------------------------------------------

/** Bounds when stored; else the outline's extent; else the extent of the drawn grills (so the panel can still be placed). */
export function panelExtent(v: PanelView): Bounds {
  if (v.bounds) return v.bounds;
  if (v.outline) {
    const b = pointsBox(v.outline);
    return { width: Math.max(0, b.x1), height: Math.max(0, b.y1) };
  }
  let width = 0;
  let height = 0;
  for (const g of v.grills) for (const p of grillGeometry(g)?.pts ?? []) {
    width = Math.max(width, p.x);
    height = Math.max(height, p.y);
  }
  return { width, height };
}

/** World-space bottom-left origin of each panel. */
export function computeOrigins(views: PanelView[], mode: LayoutMode): Map<string, Point> {
  const out = new Map<string, Point>();
  const maxDim = Math.max(1, ...views.map((v) => {
    const e = panelExtent(v);
    return Math.max(e.width, e.height);
  }));
  const gap = maxDim * 0.15;
  let cursor = 0;
  let baseY = 0;
  let pending = views;

  if (mode === 'assembled') {
    let maxX = -Infinity;
    let minY = Infinity;
    for (const v of views) {
      if (!v.slot) continue;
      const e = panelExtent(v);
      out.set(v.key, { x: v.slot.x, y: v.slot.y });
      maxX = Math.max(maxX, v.slot.x + e.width);
      minY = Math.min(minY, v.slot.y);
    }
    if (Number.isFinite(maxX)) cursor = maxX + gap;
    if (Number.isFinite(minY)) baseY = minY;
    pending = views.filter((v) => !v.slot);
  }
  for (const v of pending) {
    out.set(v.key, { x: cursor, y: baseY });
    cursor += panelExtent(v).width + gap;
  }
  return out;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function worldBBox(views: PanelView[], origins: Map<string, Point>): BBox | null {
  let b: BBox | null = null;
  const grow = (x: number, y: number) => {
    if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
  };
  for (const v of views) {
    const o = origins.get(v.key);
    if (!o) continue;
    const e = panelExtent(v);
    grow(o.x, o.y);
    grow(o.x + e.width, o.y + e.height);
    for (const p of v.outline ?? []) grow(o.x + p.x, o.y + p.y);
    for (const g of v.grills) for (const p of grillGeometry(g)?.pts ?? []) grow(o.x + p.x, o.y + p.y);
  }
  return b;
}
