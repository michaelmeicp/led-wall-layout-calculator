# LED Wall Layout Calculator

A responsive, client-side cabinet planner. Unlimited device-local panel library, one or two rectangular zones, live SVG elevation, lockable whole-layout positioning at nine anchors, per-cabinet power estimates, plain-text summary and full PNG report. Seeded models are fictional. No backend, account, runtime dependencies, pricing, inventory, ordering, 3D, or engineering calculations.

## Run & test

```sh
npm start                 # Python 3; open http://127.0.0.1:4173
npm test                  # Node 22+; calculation/validation tests
npm ci                    # official Playwright, development tests only
npm run test:browser      # installed Google Chrome; desktop/mobile/offline/export checks
```

Serve this folder with any static HTTP server; opening `index.html` directly as a file is unsupported. Deploy the repository root to GitHub Pages if desired. All assets are local.

## Geometry & pixels

Panel IDs are UUIDs. Dimensions are positive mm; pixel resolutions are positive safe integers. Empty frame axes default to active axes. Each frame axis must be at least its active axis; active area is centered in the frame. Rotation requires `rotatable` and swaps frame, active, resolution and derived pitch axes together.

**Frames tile physically. Active area defines pixels.** For each zone sizing allocation, `Nx = floor(target width / frame width)` and likewise Y for Fit inside. Cover wall uses ceil. Actual footprint is `Nx × frame width` by `Ny × frame height`; resolution is `Nx × resolution_w` by `Ny × resolution_h`. An empty axis produces zero cabinets, zero footprint and zero canvas. Utilization is summed frame footprint area / wall area. Packed zones do not overlap; a cover layout can exceed the wall area. Active aggregate dimensions exclude frame gaps; their aspect ratio can differ from the pixel aspect ratio.

Exact only uses the nearest **positive** integer count on each axis, accepted when the absolute physical residual is **≤0.5 mm per axis**, independently. It can leave a small underfill or overflow. Failure gives floor/ceil alternatives. Floor/ceil never use that tolerance: only roundoff within 16 machine epsilons of a positive integer is corrected, capped at 1e-9 in both quotient and physical mm. Arithmetic outside safe finite bounds is rejected.

Missing resolution axes derive from `round(active mm / pitch mm)` (positive halves round up); zero results are rejected. Explicit resolution wins. Actual pitch is active / resolution, independently for X/Y. A supplied pitch differing by more than 1% raises a warning.

## Power estimates

The panel library accepts optional **typical / average W per cabinet** (`typical_power_w`) and **maximum W per cabinet** (`max_power_w`). Enter ratings for the entire physical cabinet. Blank/missing/null ratings mean unknown; an explicit `0` is a known zero rating. Values must be finite, nonnegative numbers; maximum must be at least typical when both are supplied. Fictional demo panels deliberately have no power ratings. Rotation does not change a cabinet rating.

Each estimate is the installed cabinet count multiplied by the supplied rating. Results show typical and maximum estimates separately for each zone, each SKU (summing repeated selections), and the whole wall, in **W and kW**. A complete estimate covers every installed cabinet; **Partial** shows the known subtotal and cabinet coverage; **Unknown** means no installed cabinets have a rating for that estimate. A wall with no installed cabinets uses 0 W. These figures do not size circuits, distribution, cables, protection, or electrical installation.

## Zones, reports & storage

The cut sets the **sizing allocation used for cabinet counts**. Vertical cuts measure from the left; horizontal cuts from the bottom, strictly inside the wall. Fit inside / Cover wall / Exact only still calculate each zone's counts from those allocation dimensions. The allocation cut is not a fixed physical seam after the grids have been fitted and packed.

**Assemble first, position once.** A single cabinet grid is one group. Two zones are packed edge to edge with no added gap:

- Vertical arrangement: A is left, B is right; both share their bottom edge. B starts at A's actual frame width.
- Horizontal arrangement: A is bottom, B is top; both share their left edge. B starts at A's actual frame height.
- Unequal extents make a stepped outline. The relative arrangement stays fixed for all nine positions. An empty zone reserves no space.

**Configure → lock → move.** Set the wall dimensions, A/B models, rotation, sizing cut and fit. Once the fitted composition is right, choose **Lock composition**, then use the nine-position selector or 3 × 3 anchor buttons to move the complete assembly. Position can also be previewed before locking. The relative A/B arrangement stays joined as described above. The composition remains two rectangular blocks.

While locked, all composition-dependent inputs are held: wall width/height, layout mode, split direction/offset, fit strategy, panel selection/orientation and panel-library mutations (including imports and power edits). The library remains viewable and JSON export remains available. Wall name, whole-group position, summary and PNG exports stay editable/available. **Unlock composition** restores editing before any size or relative arrangement changes. A lock requires a valid layout with at least one installed cabinet.

The lock is a persisted edit guard for the current session on this browser/device. Reload restores its existing inputs, panels and lock state together; no separate frozen copy or new layout is created. Old sessions without a lock field start unlocked. A blocked edit leaves saved composition data unchanged, including delayed imports that finish after locking. Panel-library JSON remains a panel backup; it does not contain a whole-session lock, and importing it requires an unlocked composition.

The assembled group's physical outer bounding box is then aligned to the **top-left, top-center, top-right, left-center, center, right-center, bottom-left, bottom-center, or bottom-right of the wall**. Center divides leftover space equally on both axes. Edge-center anchors center one axis and attach the other to its named wall edge; corners attach both named edges. Left/right/top/bottom gaps measure from this group bounding box to the wall, using cabinet **FRAME** dimensions. They do not measure active-area insets or each zone's unused sizing allocation. A negative clearance is explicitly labelled **overflow**. Center shares overflow on opposite sides; a corner pushes it beyond opposite edges. With no cabinets, clearances are illustrative only.

For example, two vertical allocations can fit A at 1,200 × 1,350 mm and B at 900 × 1,200 mm. Their joined group is 2,100 × 1,350 mm. In a 2,500 × 1,500 mm wall, center gives left/right 200 mm and top/bottom 75 mm; B remains directly beside A with both bottom edges aligned.

Two-zone output includes individual resolutions, packed frame origins and cabinet counts by SKU. A combined canvas requires equal actual X/Y pitches, no frame/active gaps, a joined seam, matching perpendicular pixel spans and no group wall overflow. Otherwise it calls for processor mapping / two canvases.

SVG/PNG reports and copied summaries show the wall, packed frame grids, active insets, actual joined seam, orientation, **one whole-layout alignment and four wall-edge gaps/overflow**, dimensions, composition lock status, power estimates, results and warnings. PNG is 1800px wide. Dense grids use patterns or illustrative coarse lines beyond 1,200 individually drawn cabinets, with labels reduced sooner when too small; numbers are unchanged. Clipboard denial opens a selectable full-text summary. Export failures show a recoverable message.


Library and last session use `localStorage`, scoped to the browser and site origin. New sessions default to whole-group center. Saved V1.1 per-zone settings migrate the first zone's position to the single whole-layout setting; other per-zone positions are removed. Older V1 sessions without alignment retain bottom-left. Panel choices, rotation, fit, cut and power data are retained. JSON export remains `{ "version": 1, "panels": [...] }`; optional power fields are persisted/exported with each panel, and older files without them load as unknown; import also accepts an array, validates every record before changing anything, and merges by UUID, replacing matching IDs. Names/vendor ≤160 characters; notes ≤2000. No preset limit on panel count; browser storage capacity applies. Export JSON for backup or transfer.

On HTTPS or localhost, the service worker caches all local app assets after the first successful load. Reload online once before going offline; subsequent offline reloads retain calculations and the saved session. Online requests refresh cached assets; changing releases should bump the cache version in `sw.js`. Clearing site data removes library/session/cache. No data is sent to an application server.

MIT License. Early layout, pixel and supplied-rating load estimates only; installation, structure, electrical distribution and processor design require separate verification.
