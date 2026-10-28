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
