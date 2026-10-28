# LED Wall Layout Calculator

A responsive, client-side cabinet planner. Unlimited device-local panel library, one or two rectangular zones, live SVG elevation, plain-text summary and full PNG report. Seeded models are fictional. No backend, account, runtime dependencies, pricing, inventory, ordering, 3D, or engineering calculations.

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

**Frames tile physically. Active area defines pixels.** For each zone, `Nx = floor(target width / frame width)` and likewise Y for Fit inside. Cover wall uses ceil. Actual footprint is `Nx × frame width` by `Ny × frame height`; resolution is `Nx × resolution_w` by `Ny × resolution_h`. An empty axis produces zero cabinets, zero footprint and zero canvas. Utilization is summed frame footprint area / target area; overlap is counted twice and warned. Active aggregate dimensions exclude frame gaps; their aspect ratio can differ from the pixel aspect ratio.

Exact only uses the nearest **positive** integer count on each axis, accepted when the absolute physical residual is **≤0.5 mm per axis**, independently. It can leave a small underfill or overflow. Failure gives floor/ceil alternatives. Floor/ceil never use that tolerance: only roundoff within 16 machine epsilons of a positive integer is corrected, capped at 1e-9 in both quotient and physical mm. Arithmetic outside safe finite bounds is rejected.

Missing resolution axes derive from `round(active mm / pitch mm)` (positive halves round up); zero results are rejected. Explicit resolution wins. Actual pitch is active / resolution, independently for X/Y. A supplied pitch differing by more than 1% raises a warning.

## Zones, reports & storage

Vertical cuts measure from the **left**; horizontal cuts from the **bottom**, strictly inside the wall. Each zone anchors at its bottom-left; excess extends right/up. Cover overflow crossing the split can overlap the other grid and is explicitly marked. Two-zone output always includes individual resolutions and cabinet counts by SKU. A combined canvas requires equal actual X/Y pitches, no frame/active gaps, clean physical abutment, matching perpendicular pixel spans and alignment, and no zone overflow. Otherwise it calls for processor mapping / two canvases.

SVG/PNG reports show targets, actual frames, active insets, split, orientation, dimensions, results and warnings. PNG is 1800px wide. Dense grids use patterns or illustrative coarse lines beyond 1,200 individually drawn cabinets, with labels reduced sooner when too small; numbers are unchanged. Clipboard denial opens a selectable full-text summary. Export failures show a recoverable message.

Library and last session use `localStorage`, scoped to the browser and site origin. JSON export is `{ "version": 1, "panels": [...] }`; import also accepts an array, validates every record before changing anything, and merges by UUID, replacing matching IDs. Names/vendor ≤160 characters; notes ≤2000. No preset limit on panel count; browser storage capacity applies. Export JSON for backup or transfer.

On HTTPS or localhost, the service worker caches all local app assets after the first successful load. Reload online once before going offline; subsequent offline reloads retain calculations and the saved session. Online requests refresh cached assets; changing releases should bump the cache version in `sw.js`. Clearing site data removes library/session/cache. No data is sent to an application server.

MIT License. Geometry and pixel planning only; installation, structure, power and processor design remain outside V1.
