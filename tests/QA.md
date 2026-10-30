# V1.2 whole-assembly alignment correction · 2026-10-30

This correction supersedes V1.1's per-zone positioning. The fitted cabinet blocks now join first and move together as one fixed assembly; the four reported gaps are measured against the whole wall.

`npm test`: **43 passing tests** (29 calculation/validation, 14 diagram/report).

`npm run test:browser`: **18 passing checks**, actual installed Google Chrome through official Playwright at desktop 1440px and mobile 390px:

- One whole-layout selector; no per-zone position controls.
- All five positions with unequal vertical, horizontal and rotated blocks. Shared seams stay touching, relative geometry/counts remain unchanged, and wall gaps match the group bounding box.
- Cover overflow stays explicitly signed at each alignment; obsolete split/overlap claims are removed.
- Empty zones reserve no space, active insets remain frame-based, exact-fit handling and pixel mapping rules are retained.
- V1.1 sessions migrate the first zone's choice to global alignment and remove retired zone settings; older V1 sessions retain bottom-left. Power, panel choices, rotation and allocation cut survive reload.
- Typical/max power, unknown/partial/zero ratings, atomic imports, JSON backups, PNG/summary, mobile, offline reload and export error recovery remain covered. No browser JavaScript errors.

Visually inspected `qa/group-vertical.png` and `qa/group-horizontal.png`: each assembly is centered together with a stepped outline and intact shared seam. PNG and summary expose one assembly alignment and one set of four wall-edge gaps. Generated evidence stays in ignored `qa/`.

Independent review found no blocking findings. A separate 320-layout matrix covered both arrangements, fit/cover, four rotation pairs, empty/nonempty selections and all five positions, checking seams, rigid relative origins, wall gaps, power invariance and report semantics.

An additional 1,000 generated configurations across wall/split variants, both packing directions, fit/cover, all five alignments and rotations preserved relative positions, installed counts/power, joined seams and fit-inside wall bounds.

---

# V1.1 verification · 2026-10-30

`npm test`: **39 passing tests** (27 calculation/validation, 12 diagram/report).

`npm run test:browser`: **16 passing checks**, actual installed Google Chrome through official Playwright, desktop 1440px and mobile 390px. Existing V1 paths remain covered, plus:

- Center and all four corners use frame dimensions and expose left/right/top/bottom signed gaps; rotated and cover-wall overflow origins match the chosen alignment.
- Independent two-zone alignment retains clean-canvas rules and flags real split crossings/overlap.
- Optional typical/average and maximum W inputs reject negative/nonfinite values and maximum below typical.
- Installed counts produce zone, repeated-SKU and whole-wall W/kW totals; missing ratings remain unknown/partial, explicit zero remains known.
- Actual JSON downloads/imports and session reload preserve power and alignment; old libraries and sessions retain unknown power and bottom-left placement.
- PNG downloads and copied summary include alignment, four edge gaps/overflow and power totals. Invalid import remains atomic.
- Desktop/mobile/offline checks and export failure recovery pass; no browser JavaScript errors.

Screenshots and 1800px PNG reports were visually inspected. Generated evidence lives in ignored `qa/`; rerun browser tests to recreate it. GitHub Actions runs the unit suite on pushes to main and pull requests.

Independent review found no blocking findings. A separate **80-layout matrix** across five alignments, two rotations, two fit strategies and four wall sizes checked gap reconstruction, frame origins, fit-inside clearance and count-based power totals. Mobile SVG labels scale with the drawing; corresponding HTML result rows remain readable.

Power figures are arithmetic estimates from user-supplied ratings, not electrical installation verification.

---

# V1 verification · 2026-10-28

`npm test`: **26 passing tests** (19 calculation/validation, 7 diagram/report).

`npm run test:browser`: **11 passing checks**, actual installed Google Chrome through official Playwright, desktop 1440px and mobile 390px:

- Decimal cabinet defaults; two-zone mixed 600 × 337.5 / 300 × 300 aligned canvas.
- Cover overflow, split overlap and processor mapping; complete 1800px PNG download.
- Actual clipboard copy and manual-copy fallback; recoverable PNG encoding failure.
- Library add/edit/duplicate/delete, resolution derivation, atomic invalid import rejection, valid JSON merge/export, and saved library/session reload.
- Maximum-length wide Latin/CJK report names: browser SVG text bounds remain inside the image.
- Exact-fit suggestions, horizontal split validation, zero-fit outputs.
- Mobile page/library without horizontal overflow.
- Service-worker offline reload and live calculations with network offline.
- No browser JavaScript errors.

Desktop, mobile, library and two-zone PNG screenshots were visually inspected. Generated screenshots and download artifacts live in ignored `qa/`; rerun browser tests to recreate them.

An independent code review found four edge cases (SKU colors, wide report names, duplicate-name length and large-number rounding); all were corrected and regression checked. This is software planning validation, not installation engineering verification.
