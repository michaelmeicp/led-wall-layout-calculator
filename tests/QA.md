# V1.4 manual LED assembly and conversion worksheet · 2026-10-30

The previous implementation centered a group whose counts were still derived from wall-filling allocations. Fresh single-type and A+B examples both exactly filled the wall, hiding the point of placement. The previous live SVG also scaled a full report into the preview, with clearances in body text rather than on four dimension brackets.

This release makes wall dimensions and manual LED counts independent. A visible A+B example, direct cabinet-dimension links and separate manual/auto sizing controls make the intended flow discoverable. Existing sessions preserve automatic fitting and can explicitly load the new example; locked sessions can unlock from the example banner without changing their plan.

**Concrete checked example:** wall8,000×3,000mm; A4×4 of600×337.5mm =2,400×1,350mm; B6×4 of300×300mm =1,800×1,200mm; joined4,200×1,350mm,40cabinets; centered LEFT/RIGHT **gap1,900mm**, TOP/BOTTOM **gap825mm**. Actual bracket endpoints and label boxes are checked against physical wall/group bounds. Oversized and mixed-axis examples quantify each side independently and keep the complete union visible.

`npm test`: **70 passing tests** (38 core,11 conversion,21 diagram/report).

`npm run test:browser`: **24 passing checks** in installed Chrome, desktop1440px and mobile390px, no JavaScript errors. Coverage includes independent manual counts/wall edits, both arrangements/all nine anchors, positive integer validation, four dimension segments/typed labels/box bounds, centered/oversized/mixed-axis PNG and summaries, lock guards/reload/recovery, example library preservation, all legacy auto/power/import/export/offline paths, and isolated conversion worksheet state.

Conversion checks include P1.5 inverses, explicit theoretical fractional pixels versus integer suggestions and realized-size drift, missing/invalid inputs, X/Y pitch disagreement, small decimal half-up cases (.15/.1 and realistic4,990.7/2.6,392.955/3.91), and large supported dimensional drift. Independent code review found and corrected two numeric boundaries; full70 tests and a separate288-layout manual geometry/power/bracket matrix pass.

Screenshots visually inspected: `qa/manual-default-centered.png`, `qa/manual-mobile-diagram.png`, oversized and centered PNG reports, and `qa/conversion-mobile-results.png`. The centered screenshot was saved in Library for user review as `libfile_17cd6b83fa348191bc654a3360871cc4`. Generated evidence remains ignored in `qa/`.

---

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
