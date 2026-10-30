# V1.3 nine positions and composition lock · local verification · 2026-10-30

`npm test`: **48 passing tests** (32 calculation/validation, 16 diagram/report).

`npm run test:browser`: **19 passing checks** in installed Google Chrome through official Playwright (1440px desktop / 390px mobile), with no JavaScript errors.

- All nine anchors are covered for unequal vertical, horizontal and rotated A/B assemblies. Their shared seam, relative geometry, frame bounds, wall gaps and signed overflow remain correct.
- Configure → lock → move → unlock is verified. Locked composition holds wall sizing, mode, split, fit, models, orientation and every panel-library mutation. Anchors, name, viewing and JSON/summary/PNG exports remain available.
- Synthetic disabled input/change/submit/button/import events leave saved composition unchanged. A valid import started while unlocked and completed after locking is also rejected without mutation.
- Every locked anchor survives a reload with the held composition and lock status; unlocking restores editing. Invalid or empty compositions cannot be locked.
- Old sessions without a lock field restore unlocked, prior alignment migration remains compatible, library imports after unlocking still work, and power/unknown/partial/zero estimates remain covered.
- Summary, live SVG and the 1800px PNG show lock status. Mobile layout, offline reload, error recovery and existing library/report checks remain covered.

Visually inspected `qa/locked-composition-ui.png` and `qa/locked-composition.png`. Screenshot/download evidence remains in ignored `qa/`.

Independent review found no blocking findings. An independent **576-layout matrix** tested both arrangements, fit/cover, all rotation pairs, empty/nonempty selections and all nine anchor factors, confirming wall gaps, rigid relative geometry, lock equality, unchanged power and report status. Every composition mutation handler was reviewed, including both sides of the asynchronous import boundary.

This extension is committed locally only. No push or deployment was attempted; publication remains pending separate approval after the prior production push denial.

---

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
