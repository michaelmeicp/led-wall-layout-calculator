import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePanel, parseLibrary, orientPanel, calculate } from '../core.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const panel = (overrides = {}) => ({ id: uuid(1), name: 'FAKE 600', active_width_mm: 600, active_height_mm: 337.5, resolution_w: 192, resolution_h: 108, rotatable: true, ...overrides });
const config = (overrides = {}) => ({ wall: { width_mm: 2400, height_mm: 1350 }, mode: 'single', strategy: 'fit_inside', zones: [{ panelId: uuid(1), rotated: false }], ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('decimal 600 × 337.5 frame tiles with integer resolution', () => {
  const result = calculate(config(), [panel()]);
  assert.equal(result.totalCount, 16);
  assert.deepEqual([result.zones[0].nx, result.zones[0].ny], [4, 4]);
  assert.deepEqual([result.zones[0].actualWidth, result.zones[0].actualHeight], [2400, 1350]);
  assert.deepEqual([result.canvas.width, result.canvas.height], [768, 432]);
  assert.equal(result.utilization, 1);
  assert.equal(result.warnings.length, 0);
});

test('fit-inside floors and cover-wall ceils independently', () => {
  const wall = { width_mm: 2500, height_mm: 1400 };
  const inside = calculate(config({ wall }), [panel()]).zones[0];
  const cover = calculate(config({ wall, strategy: 'cover_wall' }), [panel()]).zones[0];
  assert.deepEqual([inside.nx, inside.ny, inside.deltaW, inside.deltaH], [4, 4, 100, 50]);
  assert.deepEqual([cover.nx, cover.ny, cover.deltaW, cover.deltaH], [5, 5, -500, -287.5]);
  assert.equal(inside.warnings[0].level, 'amber');
  assert.equal(cover.warnings[0].level, 'red');
  assert.ok(cover.utilization > 1);
});

test('exact-only accepts inclusive ±0.5 mm physical residual per axis', () => {
  const exact = wall => calculate(config({ wall, strategy: 'exact_only' }), [panel()]);
  assert.equal(exact({ width_mm: 2400.5, height_mm: 1349.5 }).totalCount, 16);
  assert.equal(exact({ width_mm: 2399.5, height_mm: 1350.5 }).totalCount, 16);
  assert.throws(() => exact({ width_mm: 2400.500001, height_mm: 1350 }), /Fit inside: 4.*cover wall: 5/);
  assert.throws(() => exact({ width_mm: 2399.499999, height_mm: 1350 }), /±0.5 mm/);
  // Other fit modes must not inherit the half-millimetre allowance.
  assert.equal(calculate(config({ wall: { width_mm: 2399.9, height_mm: 1350 } }), [panel()]).zones[0].nx, 3);
  assert.equal(calculate(config({ wall: { width_mm: 2400.1, height_mm: 1350 }, strategy: 'cover_wall' }), [panel()]).zones[0].nx, 5);
});

test('machine-rounding guard avoids a false extra cabinet for decimal inputs', () => {
  const p = panel({ active_width_mm: 0.1, active_height_mm: 0.1, resolution_w: 1, resolution_h: 1 });
  assert.equal(calculate(config({ wall: { width_mm: 0.3, height_mm: 0.3 }, strategy: 'cover_wall' }), [p]).totalCount, 9);
  assert.equal(calculate(config({ wall: { width_mm: 0.3, height_mm: 0.3 } }), [p]).totalCount, 9);
  const tinyTarget = calculate(config({ wall: { width_mm: 1e-13, height_mm: 337.5 }, strategy: 'cover_wall' }), [panel()]);
  assert.deepEqual([tinyTarget.zones[0].nx, tinyTarget.zones[0].ny], [1, 1]);
});

test('large dimensions cannot turn meaningful physical residuals into rounding noise', () => {
  const one = panel({ active_width_mm: 1, active_height_mm: 1, resolution_w: 1, resolution_h: 1 });
  const largeWall = { width_mm: 1000000000000000.5, height_mm: 1 };
  const inside = calculate(config({ wall: largeWall }), [one]).zones[0];
  assert.equal(inside.nx, 1000000000000000);
  assert.equal(inside.deltaW, 0.5);
  assert.ok(inside.warnings.some(w => w.level === 'amber' && /underfills/.test(w.message)));
  const cover = calculate(config({ wall: largeWall, strategy: 'cover_wall' }), [one]).zones[0];
  assert.equal(cover.nx, 1000000000000001);
  assert.equal(cover.deltaW, -0.5);
  assert.ok(cover.warnings.some(w => w.level === 'red' && /overflows/.test(w.message)));
  const wide = panel({ active_width_mm: 1000000000000000, active_height_mm: 1, resolution_w: 1, resolution_h: 1 });
  const wideCover = calculate(config({ wall: largeWall, strategy: 'cover_wall' }), [wide]).zones[0];
  assert.equal(wideCover.nx, 2, 'near-integer quotient still has a meaningful 0.5 mm physical residual');
  const cut = 1000000000000000.5;
  const twoZones = calculate(config({ wall: { width_mm: 2000000000000001, height_mm: 1 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: cut }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] }), [one]);
  assert.equal(twoZones.canvas.combined, false, 'a physical 0.5 mm gap at the cut prevents a clean combined canvas');
});

test('rotation swaps frame, active area, resolution and pitches together', () => {
  const p = panel({ frame_width_mm: 620, frame_height_mm: 350 });
  const rotated = orientPanel(p, true);
  assert.deepEqual([rotated.frame_width_mm, rotated.frame_height_mm, rotated.active_width_mm, rotated.active_height_mm, rotated.resolution_w, rotated.resolution_h], [350, 620, 337.5, 600, 108, 192]);
  assert.deepEqual([rotated.actual_pitch_x_mm, rotated.actual_pitch_y_mm], [3.125, 3.125]);
  assert.equal(calculate(config({ wall: { width_mm: 700, height_mm: 1240 }, zones: [{ panelId: uuid(1), rotated: true }] }), [p]).totalCount, 4);
  assert.throws(() => orientPanel(panel({ rotatable: false }), true), /does not allow rotation/);
  assert.throws(() => orientPanel(p, 'false'), /Rotation must be/);
});

test('frame governs tiling while active dimensions govern pixel pitch', () => {
  const result = calculate(config(), [panel({ active_width_mm: 580, active_height_mm: 320, frame_width_mm: 600, frame_height_mm: 337.5 })]);
  const z = result.zones[0];
  assert.deepEqual([z.nx, z.ny, z.actualWidth, z.actualHeight], [4, 4, 2400, 1350]);
  assert.deepEqual([z.activeWidth, z.activeHeight, z.resolutionW, z.resolutionH], [2320, 1280, 768, 432]);
  close(z.panel.actual_pitch_x_mm, 580 / 192);
  assert.throws(() => normalizePanel(panel({ frame_width_mm: 599 })), /cannot conceal/);
  assert.throws(() => normalizePanel(panel({ frame_height_mm: 337.4 })), /cannot conceal/);
  assert.equal(normalizePanel(panel({ frame_width_mm: '' })).frame_width_mm, 600);
});

test('resolution derives axis by axis, rounds nearest with half up, explicit wins', () => {
  const p = normalizePanel(panel({ active_width_mm: 601, active_height_mm: 337, resolution_w: '', resolution_h: null, pixel_pitch_mm: 2 }));
  assert.deepEqual([p.resolution_w, p.resolution_h], [301, 169]);
  assert.equal(p.derived_resolution_w, true);
  const mixed = normalizePanel(panel({ resolution_w: 100, resolution_h: '', pixel_pitch_mm: 3.125 }));
  assert.deepEqual([mixed.resolution_w, mixed.resolution_h], [100, 108]);
  assert.match(mixed.warnings[0].message, /more than 1%/);
  assert.throws(() => normalizePanel(panel({ resolution_w: '', pixel_pitch_mm: '' })), /Resolution width is required/);
  assert.throws(() => normalizePanel(panel({ resolution_w: '', pixel_pitch_mm: 2000 })), /Derived resolution width/);
  assert.equal(normalizePanel(panel({ pixel_pitch_mm: 3.125 })).warnings.length, 0);
});

test('1% pitch warning threshold is relative to supplied pitch', () => {
  const atBoundary = normalizePanel(panel({ active_width_mm: 101, resolution_w: 100, pixel_pitch_mm: 1 }));
  assert.ok(!atBoundary.warnings.some(w => /width resolution/.test(w.message)));
  const pastBoundary = normalizePanel(panel({ active_width_mm: 101.00001, resolution_w: 100, pixel_pitch_mm: 1 }));
  assert.ok(pastBoundary.warnings.some(w => /width resolution/.test(w.message)));
});

test('two vertical zones combine only with equal derived pitch and aligned clean abutment', () => {
  const square = panel({ id: uuid(2), name: 'FAKE 300', active_width_mm: 300, active_height_mm: 300, resolution_w: 96, resolution_h: 96 });
  const cfg = config({ wall: { width_mm: 2400, height_mm: 2700 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] });
  const r = calculate(cfg, [panel(), square]);
  assert.deepEqual(r.zones.map(z => [z.label, z.x, z.y, z.nx, z.ny, z.resolutionW, z.resolutionH]), [['Left zone', 0, 0, 2, 8, 384, 864], ['Right zone', 1200, 0, 4, 9, 384, 864]]);
  assert.equal(r.totalCount, 52);
  assert.deepEqual(r.counts.map(c => c.count), [16, 36]);
  assert.equal(r.canvas.combined, true);
  assert.deepEqual([r.canvas.width, r.canvas.height], [768, 864]);
  const mismatched = calculate(cfg, [panel(), { ...square, resolution_w: 100 }]);
  assert.equal(mismatched.canvas.combined, false);
  assert.match(mismatched.canvas.reason, /pitches differ/);
  assert.ok(mismatched.warnings.some(w => /Mixed actual pixel pitches/.test(w.message)));
});

test('horizontal offsets measure from bottom, with bottom-left anchors', () => {
  const square = panel({ active_width_mm: 300, active_height_mm: 300, resolution_w: 100, resolution_h: 100 });
  const r = calculate(config({ wall: { width_mm: 1200, height_mm: 1500 }, mode: 'two_zones', split: { direction: 'horizontal', offset_mm: 600 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] }), [square]);
  assert.deepEqual(r.zones.map(z => [z.label, z.x, z.y, z.width, z.height]), [['Bottom zone', 0, 0, 1200, 600], ['Top zone', 0, 600, 1200, 900]]);
  assert.equal(r.canvas.combined, true);
  assert.deepEqual([r.canvas.width, r.canvas.height], [400, 500]);
  assert.equal(r.counts.length, 1);
  assert.equal(r.counts[0].count, 20);
});

test('same nominal pitch cannot override different actual pixel pitch', () => {
  const p = panel({ pixel_pitch_mm: 3 });
  const p2 = panel({ id: uuid(2), active_width_mm: 300, active_height_mm: 300, resolution_w: 100, resolution_h: 100, pixel_pitch_mm: 3 });
  const r = calculate(config({ wall: { width_mm: 2400, height_mm: 2700 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] }), [p, p2]);
  assert.equal(r.canvas.combined, false);
  assert.ok(r.warnings.some(w => /Mixed/.test(w.message)));
});

test('frame gaps, unequal perpendicular spans and cut gaps require mapping', () => {
  const cfg = config({ wall: { width_mm: 2500, height_mm: 1350 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1250 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
  assert.match(calculate(cfg, [panel()]).canvas.reason, /do not abut/);
  const noGaps = { ...cfg, wall: { width_mm: 2400, height_mm: 1350 }, split: { direction: 'vertical', offset_mm: 1200 } };
  assert.match(calculate(noGaps, [panel({ active_width_mm: 590, frame_width_mm: 600 })]).canvas.reason, /active-area gaps/);
  const p2 = panel({ id: uuid(2), active_width_mm: 600, active_height_mm: 300, resolution_w: 192, resolution_h: 96 });
  assert.match(calculate({ ...noGaps, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] }, [panel(), p2]).canvas.reason, /matching aligned vertical pixel spans/);
});

test('cover-wall crossing the cut is explicitly flagged as overlap', () => {
  const cfg = config({ wall: { width_mm: 2500, height_mm: 1400 }, mode: 'two_zones', strategy: 'cover_wall', split: { direction: 'vertical', offset_mm: 1250 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
  const r = calculate(cfg, [panel()]);
  assert.equal(r.canvas.combined, false);
  assert.ok(r.warnings.some(w => w.level === 'red' && /crosses the split and overlaps/.test(w.message)));
  const horizontal = calculate({ ...cfg, split: { direction: 'horizontal', offset_mm: 700 } }, [panel()]);
  assert.ok(horizontal.warnings.some(w => /Bottom zone crosses the split/.test(w.message)));
});

test('zero-fitting cabinet axes have zero footprint, active size and resolution', () => {
  const result = calculate(config({ wall: { width_mm: 200, height_mm: 1000 } }), [panel()]);
  const z = result.zones[0];
  assert.deepEqual([z.nx, z.ny, z.count, z.actualWidth, z.actualHeight, z.activeWidth, z.activeHeight, z.resolutionW, z.resolutionH, result.utilization], [0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(result.canvas.combined, false);
  assert.match(z.warnings[0].message, /too small/);
  assert.throws(() => calculate(config({ wall: { width_mm: 0.1, height_mm: 0.1 }, strategy: 'exact_only' }), [panel()]), /no exact integer fit/);
});

test('library JSON round trip, raw arrays, empty libraries and atomic rejection', () => {
  const normalized = normalizePanel(panel());
  assert.deepEqual(parseLibrary(JSON.stringify({ version: 1, panels: [normalized] })), [normalized]);
  assert.equal(parseLibrary([panel()]).length, 1);
  assert.deepEqual(parseLibrary({ version: 1, panels: [] }), []);
  for (const bad of ['{bad', { version: 2, panels: [] }, { version: 1, panels: {} }, [panel(), panel()], [{ ...panel(), id: null }], [{ ...panel(), id: 'bad' }], [panel(), { ...panel({ id: uuid(2) }), active_width_mm: 0 }]]) {
    assert.throws(() => parseLibrary(bad));
  }
  assert.throws(() => parseLibrary([panel({ rotatable: 'false' })]), /Rotatable must be/);
  const uppercase = panel({ id: uuid(1).toUpperCase() });
  assert.throws(() => parseLibrary([panel(), uppercase]), /Duplicate panel UUID/);
});

test('UUIDs canonicalize to lowercase and text limits protect reports/imports', () => {
  const mixedId = 'A0000000-ABCD-4000-8000-00000000000B';
  const imported = parseLibrary([panel({ id: mixedId })]);
  assert.equal(imported[0].id, mixedId.toLowerCase());
  const r = calculate(config({ zones: [{ panelId: mixedId }] }), imported);
  assert.equal(r.zones[0].panel.id, mixedId.toLowerCase());
  assert.throws(() => parseLibrary([panel({ id: mixedId }), panel({ id: mixedId.toLowerCase() })]), /Duplicate panel UUID/);
  for (const key of ['name', 'vendor']) {
    assert.equal(normalizePanel(panel({ [key]: 'a'.repeat(160) }))[key].length, 160);
    assert.throws(() => parseLibrary([panel({ [key]: 'a'.repeat(161) })]), /160 characters or fewer/);
  }
  assert.equal(normalizePanel(panel({ notes: 'a'.repeat(2000) })).notes.length, 2000);
  assert.throws(() => parseLibrary([panel({ notes: 'a'.repeat(2001) })]), /2000 characters or fewer/);
  assert.equal(calculate(config({ wall: { width_mm: 2400, height_mm: 1350, name: 'a'.repeat(160) } }), [panel()]).wall.name.length, 160);
  assert.throws(() => calculate(config({ wall: { width_mm: 2400, height_mm: 1350, name: 'a'.repeat(161) } }), [panel()]), /Wall name must be 160/);
});

test('invalid fields never become NaN or silently default', () => {
  for (const key of ['active_width_mm', 'active_height_mm', 'frame_width_mm', 'frame_height_mm', 'resolution_w', 'resolution_h', 'pixel_pitch_mm']) {
    for (const value of [0, -1, NaN, Infinity, {}, [], true, 'bad']) assert.throws(() => normalizePanel(panel({ [key]: value })), `${key}: ${value}`);
  }
  assert.throws(() => normalizePanel(panel({ resolution_w: 1.5 })), /integer/);
  assert.throws(() => normalizePanel(panel({ resolution_h: Number.MAX_SAFE_INTEGER + 1 })), /safe integer/);
  assert.throws(() => normalizePanel(panel({ name: '  ' })), /name is required/);
  assert.throws(() => normalizePanel(panel({ notes: {} })), /Notes must be text/);
  assert.equal(normalizePanel({ ...panel(), id: undefined }).id.length, 36);
});

test('wall, split, selection and numerical-range validation', () => {
  for (const width_mm of [0, -1, NaN, Infinity, '']) assert.throws(() => calculate(config({ wall: { width_mm, height_mm: 1350 } }), [panel()]));
  const cfg = config({ mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
  for (const offset_mm of [0, -1, 2400, 2500, Infinity]) assert.throws(() => calculate({ ...cfg, split: { direction: 'vertical', offset_mm } }, [panel()]));
  assert.throws(() => calculate({ ...cfg, split: { direction: 'diagonal', offset_mm: 100 } }, [panel()]));
  assert.throws(() => calculate(config({ zones: [{ panelId: uuid(2) }] }), [panel()]), /Choose a library panel/);
  assert.throws(() => calculate(config({ zones: [] }), [panel()]), /exactly one/);
  assert.throws(() => calculate(config({ strategy: 'random' }), [panel()]), /fit strategy/);
  assert.throws(() => calculate(config({ wall: { width_mm: 1e300, height_mm: 1e300 } }), [panel()]), /numerical range/);
  assert.throws(() => calculate(config({ wall: { width_mm: 1e10, height_mm: 1e10 } }), [panel({ active_width_mm: 1, active_height_mm: 1 })]), /numerical range/);
  for (const key of ['active_width_mm', 'active_height_mm', 'frame_width_mm', 'frame_height_mm']) {
    assert.throws(() => normalizePanel(panel({ [key]: 1e300 })), /numerical range/);
    assert.throws(() => normalizePanel(panel({ [key]: 1e-310 })), /numerical range/);
  }
  assert.throws(() => calculate(config({ wall: { width_mm: 1e-310, height_mm: 1 } }), [panel()]), /too small/);
});
