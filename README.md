# Grill Viewer

Read-only 2D viewer for stored grill payloads (the array of panels with `metadata.grills`).
It draws what is stored and reports inconsistencies; it never edits, recomputes or "fixes" values.

```bash
npm install
npm run dev          # open the printed URL; add ?sample to start with the bundled sample
npm run build        # type-check + production build into dist/
```

## Using it

- **Load data**: paste JSON and press *Visualize*, use *Upload…*, or drop a `.json` file anywhere.
  Accepted: an array of panels, `{ panels | polygons | items | data: [...] }`, a single panel,
  a bare `metadata` object (`{ polygonId, bounds, grills }`), an OpticutGrills sealed-unit record with a
  `threeDGrills` block (or the bare block, or an array of records; the block may itself be a JSON string),
  or any of these JSON-encoded as a string. For sealed-unit records only `threeDGrills` is read.
- **Navigate**: drag to pan, scroll to zoom, `F` to fit, `Esc` to clear the selection.
- **Inspect**: click a panel or grill. The right pane shows every stored field; hover a value to see
  it exactly as stored (distinguishes missing / `null` / blank). Notch connection chips jump to the
  connected grill; the selected grill shows its start (**S**, square) and end (**E**, circle).
- **Layouts**: *Assembled* places each panel at its `layout.slot`; *Separate* lays panels side by side
  in input order. Panels can be hidden from the sidebar.
- **Export**: *SVG* saves the current view; *CSV* writes one row per grill with raw stored values
  (panel-local coordinates; a missing field is an empty cell, `null` is written as `null`).

## How the data is read

| Field | Interpretation |
|---|---|
| `metadata.grills[].start/end/points` | Panel-local coordinates, origin at the panel's bottom-left, **y up** |
| `metadata.points` / `threeDGrills.points` | Panel outline polygon (panel-local, same axes as the grills). When present it is drawn **solid** as the true shape, grill containment is checked against it, and without stored bounds the dimensions show its width × height extent |
| `threeDGrills.v` | Stored format version; anything other than `1` raises a warning. `signature`, `override` and `deletedIds` are read like the panel fields of the same name |
| `metadata.bounds` | Panel rectangle. For shaped panels (`override` set or `rowType: "shape"`) without `points`, the true outline is not in the payload, so the bounds are drawn **dashed** |
| `layout.slot` `"row:col:x,y"` | `x,y` taken as the panel's bottom-left offset in the assembly (**assumption**, inferred from sample data) |
| `layout.signature` | Shown verbatim, not interpreted |
| Curved grills | Drawn through the stored `points[]`. Without them, a dashed straight chord is drawn and a warning is raised |

No units field exists in the payload, so values are shown unitless. The precision selector only
changes display; checks and CSV always use the full stored values. Grills are drawn as centerlines
(the payload has no bar width).

## Checks

Read-only consistency tests, listed per panel and in the sidebar:

- missing or non-numeric bounds, start/end, points, length; malformed `layout.slot`; slot row/col vs `rowIndex`/`columnIndex`
- duplicate panel or grill ids; `metadata.polygonId` ≠ panel id; unexpected `coordinateSystem`
- notch connections to grills that are not in the panel
- notch connection `at: start|end` where that grill's endpoint is not at the notch point (tolerance 1e-4)
- geometry outside the panel outline `points` (tolerance 1e-3, since curved outline edges are sampled; only stored grill
  points are tested), or outside the bounds (tolerance 1e-6) when there is no outline
- `points` malformed or fewer than 3, zero-area outline, outline extending outside `bounds`, `threeDGrills.v` ≠ 1
- `metadata.counts.<type>` and each grill's `count` vs the grills actually present
- *info*: stored `length` vs drawn geometry (1e-6 for straight grills; >0.5% for sampled curves), `visible:false` grills, `deletedIds`, types missing from `counts`

## Files

- `src/model.ts`: parsing, validation, layout and geometry helpers (no React)
- `src/GrillCanvas.tsx`: SVG drawing, pan/zoom, hit-testing
- `src/Details.tsx`, `src/Sidebar.tsx`: inspection panes
- `src/exporters.ts`: SVG / CSV download
- `src/sample.json`: built from a pasted snapshot. The gothic panel was truncated in that paste, so it
  contains only `curved_1` and deliberately raises warnings for the grills its notches reference.
