// Display-only formatting. Nothing here feeds back into data; hover any value to
// see the exact stored representation via raw().

export type Precision = 2 | 3 | 4 | 6 | 'full';

export function fmt(v: unknown, p: Precision = 3): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || p === 'full') return String(v);
    return v.toFixed(p);
  }
  if (typeof v === 'string') return v === '' ? '(blank)' : v;
  if (typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Exact stored value, distinguishing missing / null / blank / number / string. */
export function raw(v: unknown): string {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v);
}

export function fmtPoint(pt: unknown, p: Precision): string {
  if (pt && typeof pt === 'object' && 'x' in pt && 'y' in pt) {
    const { x, y } = pt as { x: unknown; y: unknown };
    return `(${fmt(x, p)}, ${fmt(y, p)})`;
  }
  return fmt(pt, p);
}
