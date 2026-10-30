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
