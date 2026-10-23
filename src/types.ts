// Shapes of the stored grill payload. Every field is optional because the viewer
// must show malformed / partial records as they are rather than fill in defaults.

export interface Point {
  x: number;
  y: number;
}

export interface Connection {
  grillId?: string;
  at?: string;
}

export interface Notch {
  point?: Point;
  distance?: number;
  connections?: Connection[];
}

export interface Grill {
  id?: string;
  type?: string;
  start?: Point;
  end?: Point;
  points?: Point[];
  length?: number;
  angle?: number;
  notches?: Notch[];
  index?: number;
  count?: number;
  groupId?: string;
  source?: string;
  visible?: boolean;
  selected?: boolean;
}

export interface Bounds {
  width: number;
  height: number;
}

export interface PanelMetadata {
  polygonId?: string;
  coordinateSystem?: string;
  bounds?: Partial<Bounds>;
  /** Panel outline polygon, panel-local. Not every panel is rectangular. */
  points?: Point[];
  grills?: Grill[];
  counts?: Record<string, unknown>;
}

/** `threeDGrills` block of an OpticutGrills sealed-unit record. */
export interface ThreeDGrills {
  v?: unknown;
  override?: unknown;
  signature?: string;
  deletedIds?: unknown[];
  points?: Point[];
  grills?: Grill[];
}

export interface Panel {
  id?: string;
  rowIndex?: number;
  rowType?: string;
  columnIndex?: number;
  layout?: { slot?: string; signature?: string } | null;
  override?: unknown;
  alignable?: boolean;
  hubScales?: unknown;
  deletedIds?: unknown[];
  alignedMoves?: unknown[];
  metadata?: PanelMetadata;
  /** Set when the panel was read from a `threeDGrills` block; `v` is its stored version. */
  format?: { kind: 'threeDGrills'; v: unknown };
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  panelIndex: number;
  grillId?: string;
  message: string;
}

/** Parsed `layout.slot` ("row:col:x,y"). */
export interface Slot {
  row: number;
  col: number;
  x: number;
  y: number;
}

export interface PanelView {
  /** Unique per input position — panel ids are not guaranteed unique. */
  key: string;
  index: number;
  panel: Panel;
  slot: Slot | null;
  bounds: Bounds | null;
  /** Stored outline polygon (`points`), when present and numeric. */
  outline: Point[] | null;
  grills: Grill[];
  issues: Issue[];
}

export type LayoutMode = 'assembled' | 'separate';

export interface Selection {
  panelKey: string;
  /** Index into PanelView.grills (grill ids may be missing or duplicated). */
  grillIndex?: number;
}
