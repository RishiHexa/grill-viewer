import type { PanelView } from './types';
import { arr } from './model';

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves the current view (what is on screen) as a standalone SVG. */
export function exportSvg(svg: SVGSVGElement, name: string) {
  const ns = 'http://www.w3.org/2000/svg';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', ns);
  clone.querySelectorAll('.hit').forEach((e) => e.remove());
  const r = svg.getBoundingClientRect();
  clone.setAttribute('width', String(Math.round(r.width)));
  clone.setAttribute('height', String(Math.round(r.height)));
  const vb = svg.viewBox.baseVal;
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', String(vb.x));
  bg.setAttribute('y', String(vb.y));
  bg.setAttribute('width', String(vb.width));
  bg.setAttribute('height', String(vb.height));
  bg.setAttribute('fill', '#ffffff');
  const style = clone.querySelector('style');
  clone.insertBefore(bg, style ? style.nextSibling : clone.firstChild);
  download(name, 'image/svg+xml', new XMLSerializer().serializeToString(clone));
}

// undefined (missing) → empty cell, null → "null", numbers/strings exactly as stored.
function cell(v: unknown): string {
  if (v === undefined) return '';
  const s = v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  'panel', 'panelId', 'rowIndex', 'rowType', 'columnIndex', 'slot',
  'grillId', 'type', 'groupId', 'index', 'count', 'source', 'visible',
  'length', 'angle', 'startX', 'startY', 'endX', 'endY', 'notchCount', 'pointCount',
];

/** One row per grill with raw stored values (panel-local coordinates). */
export function exportCsv(views: PanelView[], name: string) {
  const rows = [COLUMNS.join(',')];
  for (const v of views) {
    for (const g of v.grills) {
      rows.push([
        `P${v.index + 1}`, v.panel.id, v.panel.rowIndex, v.panel.rowType, v.panel.columnIndex, v.panel.layout?.slot,
        g.id, g.type, g.groupId, g.index, g.count, g.source, g.visible,
        g.length, g.angle, g.start?.x, g.start?.y, g.end?.x, g.end?.y,
        arr(g.notches).length, Array.isArray(g.points) ? g.points.length : undefined,
      ].map(cell).join(','));
    }
  }
  download(name, 'text/csv', rows.join('\r\n') + '\r\n');
}
