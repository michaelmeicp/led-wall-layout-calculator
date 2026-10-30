import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePanel, parseLibrary, orientPanel, calculate, ALIGNMENTS, alignmentName, gapText, powerText, resolveAlignment, resolveCompositionLocked, resolveSizingMode } from '../core.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const panel = (overrides = {}) => ({ id: uuid(1), name: 'FAKE 600', active_width_mm: 600, active_height_mm: 337.5, resolution_w: 192, resolution_h: 108, rotatable: true, ...overrides });
const config = (overrides = {}) => ({ wall: { width_mm: 2400, height_mm: 1350 }, mode: 'single', strategy: 'fit_inside', zones: [{ panelId: uuid(1), rotated: false }], ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const manualConfig = (overrides = {}) => config({ wall: { width_mm: 8000, height_mm: 3000 }, mode: 'two_zones', sizingMode: 'manual', arrangement: 'side_by_side', alignment: 'center', zones: [{ panelId: uuid(1), columns: 4, rows: 4 }, { panelId: uuid(2), columns: 6, rows: 4 }], ...overrides });
const squarePanel = (overrides = {}) => panel({ id: uuid(2), name: 'FAKE 300', active_width_mm: 300, active_height_mm: 300, resolution_w: 96, resolution_h: 96, ...overrides });

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
  assert.ok(cover.warnings.some(w => /exceeds its sizing allocation/.test(w.message)));
  assert.ok(calculate(config({ wall, strategy: 'cover_wall' }), [panel()]).warnings.some(w => w.level === 'red' && /Assembly overflows/.test(w.message)));
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
  assert.ok(cover.warnings.some(w => /exceeds its sizing allocation/.test(w.message)));
  const wide = panel({ active_width_mm: 1000000000000000, active_height_mm: 1, resolution_w: 1, resolution_h: 1 });
  const wideCover = calculate(config({ wall: largeWall, strategy: 'cover_wall' }), [wide]).zones[0];
  assert.equal(wideCover.nx, 2, 'near-integer quotient still has a meaningful 0.5 mm physical residual');
  const cut = 1000000000000000.5;
  const twoZones = calculate(config({ wall: { width_mm: 2000000000000001, height_mm: 1 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: cut }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] }), [one]);
  assert.equal(twoZones.canvas.combined, true, 'packing removes the allocation residual at the internal seam');
  assert.equal(twoZones.group.deltaW, 1, 'unused allocation space becomes external wall clearance');
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

test('allocation underfill packs without a cut gap, while frame gaps and unequal spans require mapping', () => {
  const cfg = config({ wall: { width_mm: 2500, height_mm: 1350 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1250 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
  assert.equal(calculate(cfg, [panel()]).canvas.combined, true);
  assert.equal(calculate(cfg, [panel()]).group.deltaW, 100);
  const noGaps = { ...cfg, wall: { width_mm: 2400, height_mm: 1350 }, split: { direction: 'vertical', offset_mm: 1200 } };
  assert.match(calculate(noGaps, [panel({ active_width_mm: 590, frame_width_mm: 600 })]).canvas.reason, /active-area gaps/);
  const p2 = panel({ id: uuid(2), active_width_mm: 600, active_height_mm: 300, resolution_w: 192, resolution_h: 96 });
  assert.match(calculate({ ...noGaps, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] }, [panel(), p2]).canvas.reason, /matching aligned vertical pixel spans/);
});

test('cover-wall packs the zones without overlap and flags assembly wall overflow', () => {
  const cfg = config({ wall: { width_mm: 2500, height_mm: 1400 }, mode: 'two_zones', strategy: 'cover_wall', split: { direction: 'vertical', offset_mm: 1250 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
  const r = calculate(cfg, [panel()]);
  assert.equal(r.canvas.combined, false);
  assert.ok(r.warnings.some(w => w.level === 'red' && /Assembly overflows the wall/.test(w.message)));
  assert.ok(!r.warnings.some(w => /crosses the split|overlaps/.test(w.message)));
  assert.equal(r.zones[0].actualX + r.zones[0].actualWidth, r.zones[1].actualX);
  const horizontal = calculate({ ...cfg, split: { direction: 'horizontal', offset_mm: 700 } }, [panel()]);
  assert.ok(horizontal.warnings.some(w => /Assembly overflows the wall/.test(w.message)));
  assert.equal(horizontal.zones[0].actualY + horizontal.zones[0].actualHeight, horizontal.zones[1].actualY);
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

test('all nine visual-order alignments move one complete assembly using cabinet frames', () => {
  const positions = {
    top_left: [0, 50, { left: 0, right: 100, top: 0, bottom: 50 }],
    top_center: [50, 50, { left: 50, right: 50, top: 0, bottom: 50 }],
    top_right: [100, 50, { left: 100, right: 0, top: 0, bottom: 50 }],
    middle_left: [0, 25, { left: 0, right: 100, top: 25, bottom: 25 }],
    center: [50, 25, { left: 50, right: 50, top: 25, bottom: 25 }],
    middle_right: [100, 25, { left: 100, right: 0, top: 25, bottom: 25 }],
    bottom_left: [0, 0, { left: 0, right: 100, top: 50, bottom: 0 }],
    bottom_center: [50, 0, { left: 50, right: 50, top: 50, bottom: 0 }],
    bottom_right: [100, 0, { left: 100, right: 0, top: 50, bottom: 0 }],
  };
  assert.deepEqual(Object.keys(ALIGNMENTS), Object.keys(positions));
  for (const [alignment, expected] of Object.entries(positions)) {
    const r = calculate(config({ alignment, wall: { width_mm: 2500, height_mm: 1400 } }), [panel({ active_width_mm: 580, frame_width_mm: 600 })]);
    assert.deepEqual([r.group.x, r.group.y, r.group.gaps], expected, alignment);
    assert.deepEqual([r.group.width, r.group.height, r.group.hasCabinets, r.group.packing], [2400, 1350, true, 'single']);
    assert.equal(r.group.alignment, alignment);
    assert.equal(r.alignment, alignment);
    assert.deepEqual([r.zones[0].actualX, r.zones[0].actualY], expected.slice(0, 2));
    assert.ok(!Object.hasOwn(r.zones[0], 'alignment'));
    assert.ok(!Object.hasOwn(r.zones[0], 'gaps'));
  }
  assert.equal(alignmentName('top_right'), 'Top right');
  assert.equal(gapText(25), 'gap 25 mm');
  assert.equal(gapText(-25), 'overflow 25 mm');
});

test('global alignment migration validates one choice and ignores obsolete second-zone choices', () => {
  assert.equal(resolveAlignment(config()), 'bottom_left', 'V1 session fallback');
  assert.equal(resolveAlignment(config({ zones: [{ panelId: uuid(1), alignment: 'top_right' }] })), 'top_right', 'V1.1 first-zone migration');
  const cfg = config({ mode: 'two_zones', alignment: 'center', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1), alignment: 'bad' }, { panelId: uuid(1), alignment: 'also bad' }] });
  assert.equal(calculate(cfg, [panel()]).alignment, 'center', 'explicit global selection wins');
  assert.equal(calculate({ ...cfg, alignment: undefined, zones: [{ panelId: uuid(1), alignment: 'top_left' }, cfg.zones[1]] }, [panel()]).alignment, 'top_left');
  for (const alignment of ['upper_left', '', null, false, 0, {}]) assert.throws(() => calculate(config({ alignment }), [panel()]), /valid alignment/);
  assert.throws(() => resolveAlignment({ zones: [{ alignment: 'bad' }] }), /valid alignment/);
});

test('whole-assembly overflow stays signed, including rotation and exact tolerance', () => {
  const wall = { width_mm: 2500, height_mm: 1400 };
  const centered = calculate(config({ alignment: 'center', wall, strategy: 'cover_wall' }), [panel()]);
  assert.deepEqual(centered.group.gaps, { left: -250, right: -250, top: -143.75, bottom: -143.75 });
  assert.deepEqual([centered.zones[0].actualX, centered.zones[0].actualY], [-250, -143.75]);
  const corner = calculate(config({ alignment: 'top_right', wall, strategy: 'cover_wall' }), [panel()]);
  assert.deepEqual(corner.group.gaps, { left: -500, right: 0, top: 0, bottom: -287.5 });
  const rotated = calculate(config({ alignment: 'top_right', wall: { width_mm: 750, height_mm: 1300 }, zones: [{ panelId: uuid(1), rotated: true }] }), [panel({ frame_width_mm: 620, frame_height_mm: 350 })]);
  assert.deepEqual([rotated.zones[0].nx, rotated.zones[0].ny, rotated.group.x, rotated.group.y], [2, 2, 50, 60]);
  const exact = calculate(config({ alignment: 'center', wall: { width_mm: 2399.5, height_mm: 1349.5 }, strategy: 'exact_only' }), [panel()]);
  assert.deepEqual(exact.group.gaps, { left: -0.25, right: -0.25, top: -0.25, bottom: -0.25 });
  assert.ok(exact.warnings.some(w => w.level === 'red' && /Assembly overflows/.test(w.message)));
});

test('unequal vertical and horizontal zones remain one rigid joined silhouette for all nine alignments', () => {
  const other = panel({ id: uuid(2), active_width_mm: 350, active_height_mm: 300, resolution_w: 112, resolution_h: 96 });
  for (const direction of ['vertical', 'horizontal']) {
    const cfg = config({ wall: { width_mm: 2500, height_mm: 1400 }, mode: 'two_zones', split: { direction, offset_mm: direction === 'vertical' ? 1250 : 700 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] });
    const baseline = calculate({ ...cfg, alignment: 'bottom_left' }, [panel(), other]);
    const expectedSize = direction === 'vertical' ? [2250, 1350] : [2450, 1275];
    assert.deepEqual([baseline.group.width, baseline.group.height], expectedSize);
    for (const alignment of Object.keys(ALIGNMENTS)) {
      const r = calculate({ ...cfg, alignment }, [panel(), other]);
      const [a, b] = r.zones;
      assert.deepEqual(r.zones.map(z => z.count), baseline.zones.map(z => z.count));
      assert.deepEqual([r.group.width, r.group.height], expectedSize);
      assert.deepEqual([a.actualX - r.group.x, a.actualY - r.group.y], [0, 0]);
      assert.deepEqual([b.actualX - r.group.x, b.actualY - r.group.y], direction === 'vertical' ? [a.actualWidth, 0] : [0, a.actualHeight]);
      assert.equal(direction === 'vertical' ? a.actualX + a.actualWidth : a.actualY + a.actualHeight, direction === 'vertical' ? b.actualX : b.actualY, 'no internal gap or overlap');
      const expectedX = alignment.endsWith('center') ? r.group.deltaW / 2 : alignment.endsWith('right') ? r.group.deltaW : 0;
      const expectedY = alignment === 'center' || alignment.startsWith('middle_') ? r.group.deltaH / 2 : alignment.startsWith('top') ? r.group.deltaH : 0;
      assert.deepEqual([r.group.x, r.group.y], [expectedX, expectedY]);
      assert.equal(r.group.gaps.left + r.group.width + r.group.gaps.right, 2500);
      assert.equal(r.group.gaps.bottom + r.group.height + r.group.gaps.top, 1400);
      assert.equal(r.canvas.combined, false, 'unequal perpendicular extents still require processor mapping');
      assert.ok(!r.warnings.some(w => /crosses the split|overlaps/.test(w.message)));
    }
  }
});

test('packed equal spans combine even when sizing allocations underfill', () => {
  const square = panel({ active_width_mm: 300, active_height_mm: 300, resolution_w: 100, resolution_h: 100 });
  for (const direction of ['vertical', 'horizontal']) {
    const cfg = config({ alignment: 'center', wall: { width_mm: direction === 'vertical' ? 1300 : 1000, height_mm: direction === 'vertical' ? 1000 : 1300 }, mode: 'two_zones', split: { direction, offset_mm: 650 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
    const r = calculate(cfg, [square]);
    assert.equal(r.canvas.combined, true);
    assert.equal(r.group.packing, direction);
    assert.deepEqual(r.group.gaps, direction === 'vertical' ? { left: 50, right: 50, top: 50, bottom: 50 } : { left: 50, right: 50, top: 50, bottom: 50 });
    const cover = calculate({ ...cfg, strategy: 'cover_wall' }, [square]);
    assert.equal(cover.canvas.combined, false);
    assert.match(cover.canvas.reason, /assembly overflows the wall/);
    assert.ok(cover.warnings.some(w => /sizing allocation/.test(w.message)));
    assert.ok(cover.warnings.some(w => w.level === 'red' && /Assembly overflows the wall/.test(w.message)));
  }
});

test('empty zones reserve no space and all-empty assemblies stay explicit', () => {
  for (const direction of ['vertical', 'horizontal']) for (const emptyFirst of [true, false]) {
    const big = panel({ id: uuid(2), active_width_mm: 2000, active_height_mm: 2000, resolution_w: 100, resolution_h: 100 });
    const cfg = config({ alignment: 'center', wall: { width_mm: 1300, height_mm: 1300 }, mode: 'two_zones', split: { direction, offset_mm: 650 }, zones: (emptyFirst ? [uuid(2), uuid(1)] : [uuid(1), uuid(2)]).map(panelId => ({ panelId })) });
    const r = calculate(cfg, [panel(), big]);
    const installed = r.zones.find(z => z.count > 0);
    assert.deepEqual([r.group.width, r.group.height], [installed.actualWidth, installed.actualHeight]);
    assert.deepEqual([installed.actualX, installed.actualY], [r.group.x, r.group.y]);
    assert.equal(r.group.hasCabinets, true);
    const empty = calculate({ ...cfg, zones: [{ panelId: uuid(2) }, { panelId: uuid(2) }] }, [panel(), big]);
    assert.deepEqual([empty.group.width, empty.group.height, empty.group.hasCabinets, empty.group.x, empty.group.y], [0, 0, false, 650, 650]);
    assert.equal(empty.totalCount, 0);
  }
});

test('all nine locations preserve joined positions with rotation, overflow and exact residuals', () => {
  const other = panel({ id: uuid(2), active_width_mm: 350, active_height_mm: 300, resolution_w: 112, resolution_h: 96 });
  const locations = { top_left: [0, 1], top_center: [.5, 1], top_right: [1, 1], middle_left: [0, .5], center: [.5, .5], middle_right: [1, .5], bottom_left: [0, 0], bottom_center: [.5, 0], bottom_right: [1, 0] };
  for (const direction of ['vertical', 'horizontal']) for (const scenario of ['rotated', 'cover', 'exact']) {
    const vertical = direction === 'vertical';
    const cfg = config({
      wall: scenario === 'exact' ? (vertical ? { width_mm: 2599.5, height_mm: 2699.5 } : { width_mm: 4199.5, height_mm: 1274.5 }) : { width_mm: 2500, height_mm: 1400 },
      mode: 'two_zones',
      strategy: scenario === 'exact' ? 'exact_only' : scenario === 'cover' ? 'cover_wall' : 'fit_inside',
      split: { direction, offset_mm: scenario === 'exact' ? (vertical ? 1199.75 : 674.75) : vertical ? 1250 : 700 },
      zones: [{ panelId: uuid(1) }, { panelId: uuid(2), rotated: scenario === 'rotated' }],
    });
    const baseline = calculate({ ...cfg, alignment: 'bottom_left' }, [panel(), other]);
    for (const [alignment, [fx, fy]] of Object.entries(locations)) {
      const r = calculate({ ...cfg, alignment, compositionLocked: true }, [panel(), other]);
      assert.deepEqual([r.group.width, r.group.height], [baseline.group.width, baseline.group.height]);
      close(r.group.x, r.group.deltaW * fx);
      close(r.group.y, r.group.deltaH * fy);
      assert.deepEqual(r.zones.map(z => [z.nx, z.ny, z.count, z.rotated]), baseline.zones.map(z => [z.nx, z.ny, z.count, z.rotated]));
      for (const [index, zone] of r.zones.entries()) {
        close(zone.actualX - r.group.x, baseline.zones[index].actualX);
        close(zone.actualY - r.group.y, baseline.zones[index].actualY);
      }
      const [a, b] = r.zones;
      close(vertical ? a.actualX + a.actualWidth : a.actualY + a.actualHeight, vertical ? b.actualX : b.actualY);
      if (scenario !== 'rotated') {
        assert.ok(r.group.deltaW < 0 && r.group.deltaH < 0);
        assert.ok(r.warnings.some(w => w.level === 'red' && /Assembly overflows/.test(w.message)));
        assert.equal(r.canvas.combined, false);
      }
    }
  }
});

test('all nine locations handle an empty zone or empty assembly without reserving size', () => {
  const big = panel({ id: uuid(2), active_width_mm: 2000, active_height_mm: 2000, resolution_w: 100, resolution_h: 100 });
  for (const direction of ['vertical', 'horizontal']) for (const alignment of Object.keys(ALIGNMENTS)) for (const ids of [[uuid(1), uuid(2)], [uuid(2), uuid(1)], [uuid(2), uuid(2)]]) {
    const r = calculate(config({ alignment, wall: { width_mm: 1300, height_mm: 1300 }, mode: 'two_zones', split: { direction, offset_mm: 650 }, zones: ids.map(panelId => ({ panelId })) }), [panel(), big]);
    const installed = r.zones.filter(z => z.count);
    assert.equal(r.group.hasCabinets, installed.length > 0);
    assert.equal(r.group.width, installed[0]?.actualWidth ?? 0);
    assert.equal(r.group.height, installed[0]?.actualHeight ?? 0);
    if (installed.length) assert.deepEqual([installed[0].actualX, installed[0].actualY], [r.group.x, r.group.y]);
    assert.equal(r.group.gaps.left + r.group.width + r.group.gaps.right, 1300);
    assert.equal(r.group.gaps.bottom + r.group.height + r.group.gaps.top, 1300);
  }
});

test('composition lock validates a persisted edit-guard flag without changing calculations', () => {
  assert.equal(resolveCompositionLocked(config()), false);
  assert.equal(calculate(config(), [panel()]).compositionLocked, false);
  const cfg = config({ compositionLocked: true, alignment: 'middle_right', wall: { width_mm: 2500, height_mm: 1400 } });
  const persisted = JSON.parse(JSON.stringify(cfg));
  assert.equal(resolveCompositionLocked(persisted), true);
  const locked = calculate(persisted, [panel({ typical_power_w: 100, max_power_w: 200 })]);
  const unlocked = calculate({ ...persisted, compositionLocked: false }, [panel({ typical_power_w: 100, max_power_w: 200 })]);
  assert.equal(locked.compositionLocked, true);
  assert.deepEqual({ ...locked, compositionLocked: false }, unlocked);
  for (const compositionLocked of [null, '', 'true', 'false', 0, 1, {}, []]) {
    assert.throws(() => resolveCompositionLocked({ compositionLocked }), /Composition lock must be true or false/);
    assert.throws(() => calculate(config({ compositionLocked }), [panel()]), /Composition lock must be true or false/);
  }
  for (const alignment of Object.keys(ALIGNMENTS)) {
    const moved = calculate({ ...persisted, alignment }, [panel({ typical_power_w: 100, max_power_w: 200 })]);
    assert.equal(moved.compositionLocked, true);
    assert.deepEqual(moved.counts, locked.counts);
    assert.deepEqual(moved.power, locked.power);
    assert.deepEqual(moved.zones.map(z => [z.nx, z.ny]), locked.zones.map(z => [z.nx, z.ny]));
  }
});

test('manual A 4 × 4 and B 6 × 4 join on an 8000 × 3000 wall with visible external gaps', () => {
  const r = calculate(manualConfig(), [panel(), squarePanel()]);
  assert.equal(r.sizingMode, 'manual');
  assert.equal(r.arrangement, 'side_by_side');
  assert.equal(r.split, null);
  assert.deepEqual(r.zones.map(z => [z.label, z.nx, z.ny, z.count, z.actualWidth, z.actualHeight]), [['Type A', 4, 4, 16, 2400, 1350], ['Type B', 6, 4, 24, 1800, 1200]]);
  assert.equal(r.totalCount, 40);
  assert.deepEqual([r.group.width, r.group.height, r.group.x, r.group.y], [4200, 1350, 1900, 825]);
  assert.deepEqual(r.group.gaps, { left: 1900, right: 1900, top: 825, bottom: 825 });
  assert.deepEqual(r.zones.map(z => [z.actualX, z.actualY]), [[1900, 825], [4300, 825]]);
  close(r.utilization, .225);
  assert.ok(!r.warnings.some(w => /sizing allocation/.test(w.message)));
  assert.equal(gapText(r.group.gaps.left), 'gap 1,900 mm');
  assert.equal(gapText(0), 'gap 0 mm');
});

test('manual quantities and power remain independent of wall edits and auto-fit strategies', () => {
  const library = [panel({ typical_power_w: 100, max_power_w: 200 }), squarePanel({ typical_power_w: 30, max_power_w: 60 })];
  const baseline = calculate(manualConfig(), library);
  assert.equal(baseline.power.typical.watts, 2320);
  assert.equal(baseline.power.maximum.watts, 4640);
  assert.deepEqual(baseline.counts.map(entry => entry.count), [16, 24]);
  for (const wall of [{ width_mm: 10000, height_mm: 4000 }, { width_mm: 4000, height_mm: 1000 }, { width_mm: 1, height_mm: 1 }]) for (const strategy of ['fit_inside', 'cover_wall', 'exact_only']) {
    const r = calculate(manualConfig({ wall, strategy, compositionLocked: true }), library);
    assert.equal(r.totalCount, 40);
    assert.deepEqual(r.zones.map(z => [z.nx, z.ny, z.count]), baseline.zones.map(z => [z.nx, z.ny, z.count]));
    assert.deepEqual([r.group.width, r.group.height], [4200, 1350]);
    assert.deepEqual(r.power, baseline.power);
    assert.deepEqual(r.counts, baseline.counts);
    assert.ok(!r.warnings.some(w => /sizing allocation/.test(w.message)));
    assert.equal(r.compositionLocked, true);
  }
});

test('manual side-by-side and stacked groups show every side gap or overflow at all nine anchors', () => {
  const locations = { top_left: [0, 1], top_center: [.5, 1], top_right: [1, 1], middle_left: [0, .5], center: [.5, .5], middle_right: [1, .5], bottom_left: [0, 0], bottom_center: [.5, 0], bottom_right: [1, 0] };
  for (const arrangement of ['side_by_side', 'stacked']) {
    const [width, height] = arrangement === 'side_by_side' ? [4200, 1350] : [2400, 2550];
    const walls = [{ width_mm: width + 1000, height_mm: height + 600 }, { width_mm: width - 400, height_mm: height - 200 }, { width_mm: width - 400, height_mm: height + 600 }, { width_mm: width + 1000, height_mm: height - 200 }];
    for (const wall of walls) for (const [alignment, [fx, fy]] of Object.entries(locations)) {
      const r = calculate(manualConfig({ wall, arrangement, alignment }), [panel(), squarePanel()]);
      const expectedLeft = (wall.width_mm - width) * fx || 0, expectedBottom = (wall.height_mm - height) * fy || 0;
      assert.deepEqual([r.group.width, r.group.height, r.group.x, r.group.y], [width, height, expectedLeft, expectedBottom]);
      assert.deepEqual(r.group.gaps, { left: expectedLeft, right: wall.width_mm - width - expectedLeft, top: wall.height_mm - height - expectedBottom, bottom: expectedBottom });
      const [a, b] = r.zones;
      assert.deepEqual([a.actualX, a.actualY], [expectedLeft, expectedBottom]);
      assert.deepEqual([b.actualX, b.actualY], arrangement === 'side_by_side' ? [expectedLeft + 2400, expectedBottom] : [expectedLeft, expectedBottom + 1350]);
      assert.equal(r.totalCount, 40);
      assert.equal(r.group.packing, arrangement === 'side_by_side' ? 'vertical' : 'horizontal');
      assert.equal(r.split, null);
      for (const gap of Object.values(r.group.gaps)) assert.match(gapText(gap), gap < 0 ? /^overflow [\d,]+(?:\.\d+)? mm$/ : /^gap [\d,]+(?:\.\d+)? mm$/);
      const overflows = wall.width_mm < width || wall.height_mm < height;
      assert.equal(r.warnings.some(w => w.level === 'red' && /Assembly overflows/.test(w.message)), overflows);
    }
  }
});

test('manual rotation uses frame dimensions and leaves active pixels and physical insets intact', () => {
  const p = panel({ active_width_mm: 580, active_height_mm: 320, frame_width_mm: 600, frame_height_mm: 337.5 });
  const r = calculate(manualConfig({ wall: { width_mm: 4000, height_mm: 3000 }, alignment: 'top_right', zones: [{ panelId: uuid(1), columns: 3, rows: 2, rotated: true }, { panelId: uuid(2), columns: 2, rows: 1 }] }), [p, squarePanel()]);
  const [a, b] = r.zones;
  assert.deepEqual([a.nx, a.ny, a.count, a.actualWidth, a.actualHeight], [3, 2, 6, 1012.5, 1200]);
  assert.deepEqual([a.activeWidth, a.activeHeight, a.resolutionW, a.resolutionH], [960, 1160, 324, 384]);
  assert.deepEqual([r.group.width, r.group.height, r.group.x, r.group.y], [1612.5, 1200, 2387.5, 1800]);
  assert.deepEqual([b.actualX, b.actualY], [3400, 1800]);
  assert.match(r.canvas.reason, /actual derived pixel pitches differ|frame insets/);
});

test('manual mode validates explicit positive safe columns, rows and arrangement atomically', () => {
  assert.equal(resolveSizingMode({}), 'auto_fit');
  assert.equal(resolveSizingMode({ sizingMode: 'manual' }), 'manual');
  const library = [panel(), squarePanel()];
  for (const sizingMode of ['', null, false, 0, {}, 'fit']) assert.throws(() => calculate(manualConfig({ sizingMode }), library), /manual cabinet counts or automatic fit/);
  for (const arrangement of ['', null, false, 0, {}, 'vertical']) assert.throws(() => calculate(manualConfig({ arrangement }), library), /side by side or stacked/);
  for (const field of ['columns', 'rows']) for (const value of [undefined, null, '', 0, -1, .5, Infinity, NaN, true, [], {}, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculate(manualConfig({ zones: [{ panelId: uuid(1), columns: 4, rows: 4, [field]: value }, { panelId: uuid(2), columns: 6, rows: 4 }] }), library), /positive|safe integer|required/);
  }
  const defaultArrangement = calculate(manualConfig({ arrangement: undefined, split: { direction: 'bad', offset_mm: -1 } }), library);
  assert.equal(defaultArrangement.arrangement, 'side_by_side');
  assert.equal(defaultArrangement.split, null, 'manual mode does not use stale auto-fit cuts');
  assert.throws(() => calculate(manualConfig({ zones: [{ panelId: uuid(1), columns: 100000000, rows: 100000000 }, { panelId: uuid(2), columns: 6, rows: 4 }] }), library), /Cabinet count.*numerical range/);
  const stringCounts = calculate(manualConfig({ zones: [{ panelId: uuid(1), columns: '4', rows: '4' }, { panelId: uuid(2), columns: '6', rows: '4' }] }), library);
  assert.equal(stringCounts.totalCount, 40);
});

test('manual session roundtrip and single type work while old sessions retain automatic fit', () => {
  const saved = JSON.parse(JSON.stringify(manualConfig({ arrangement: 'stacked', alignment: 'bottom_center', compositionLocked: true })));
  const r = calculate(saved, [panel(), squarePanel()]);
  assert.equal(r.sizingMode, 'manual');
  assert.equal(r.arrangement, 'stacked');
  assert.equal(r.totalCount, 40);
  assert.deepEqual(r.group.gaps, { left: 2800, right: 2800, top: 450, bottom: 0 });
  const single = calculate(config({ wall: { width_mm: 8000, height_mm: 3000 }, sizingMode: 'manual', alignment: 'center', zones: [{ panelId: uuid(1), columns: 2, rows: 3 }] }), [panel()]);
  assert.equal(single.group.packing, 'single');
  assert.equal(single.totalCount, 6);
  assert.deepEqual([single.group.width, single.group.height], [1200, 1012.5]);
  const old = calculate(config(), [panel()]);
  assert.equal(old.sizingMode, 'auto_fit');
  assert.equal(old.totalCount, 16);
  assert.deepEqual(old, calculate(config({ sizingMode: 'auto_fit' }), [panel()]));
  const horizontal = config({ mode: 'two_zones', split: { direction: 'horizontal', offset_mm: 675 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] });
  const auto = calculate(horizontal, [panel()]);
  assert.equal(auto.arrangement, 'stacked');
  assert.deepEqual(auto.split, horizontal.split);
  assert.equal(auto.totalCount, 16);
});

test('optional per-panel power validates finite nonnegative values and preserves unknown', () => {
  const legacy = normalizePanel(panel());
  assert.equal(legacy.typical_power_w, null);
  assert.equal(legacy.max_power_w, null);
  const withPower = normalizePanel(panel({ typical_power_w: '125.5', max_power_w: 300 }));
  assert.equal(withPower.typical_power_w, 125.5);
  assert.equal(withPower.max_power_w, 300);
  assert.equal(normalizePanel(panel({ typical_power_w: 0, max_power_w: 0 })).typical_power_w, 0);
  assert.equal(normalizePanel(panel({ typical_power_w: '', max_power_w: null })).max_power_w, null);
  assert.throws(() => normalizePanel(panel({ typical_power_w: 301, max_power_w: 300 })), /at least typical/);
  for (const key of ['typical_power_w', 'max_power_w']) for (const value of [-1, NaN, Infinity, {}, [], true, 'bad', ' ']) assert.throws(() => normalizePanel(panel({ [key]: value })), `${key}: ${String(value)}`);
});

test('installed cabinet counts calculate power per zone, SKU and whole wall', () => {
  const p1 = panel({ typical_power_w: 100, max_power_w: 200 });
  const p2 = panel({ id: uuid(2), active_width_mm: 300, active_height_mm: 300, resolution_w: 100, resolution_h: 100, typical_power_w: 25, max_power_w: 60 });
  const r = calculate(config({ wall: { width_mm: 2400, height_mm: 1350 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1), alignment: 'center' }, { panelId: uuid(2), alignment: 'top_right', rotated: true }] }), [p1, p2]);
  assert.deepEqual(r.zones.map(z => z.count), [8, 16]);
  assert.deepEqual(r.zones.map(z => [z.power.typical.watts, z.power.maximum.watts]), [[800, 1600], [400, 960]]);
  assert.deepEqual(r.counts.map(sku => [sku.power.typical.watts, sku.power.maximum.watts]), [[800, 1600], [400, 960]]);
  assert.deepEqual(r.power.typical, { watts: 1200, knownCount: 24, totalCount: 24, status: 'complete' });
  assert.equal(r.power.maximum.watts, 2560);
  assert.equal(powerText(r.power.typical), '1,200 W / 1.2 kW');
  const sameSku = calculate(config({ mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(1) }] }), [p1]);
  assert.equal(sameSku.counts.length, 1);
  assert.equal(sameSku.counts[0].power.maximum.watts, 3200);
});

test('missing power is unknown or an explicit partial known subtotal, never a complete zero', () => {
  const p2 = panel({ id: uuid(2), typical_power_w: 0, max_power_w: 100 });
  const cfg = config({ mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] });
  const r = calculate(cfg, [panel(), p2]);
  assert.equal(r.zones[0].power.typical.status, 'unknown');
  assert.equal(powerText(r.zones[0].power.maximum), 'Unknown');
  assert.deepEqual(r.power.typical, { watts: 0, knownCount: 8, totalCount: 16, status: 'partial' });
  assert.equal(powerText(r.power.typical), 'Partial: 0 W / 0 kW known (8 of 16 cabinets)');
  assert.equal(r.power.maximum.watts, 800);
  const oneRating = calculate(config(), [panel({ max_power_w: 200 })]);
  assert.equal(oneRating.power.typical.status, 'unknown');
  assert.equal(oneRating.power.maximum.status, 'complete');
  const empty = calculate(config({ wall: { width_mm: 100, height_mm: 100 }, zones: [{ panelId: uuid(1), alignment: 'center' }] }), [panel()]);
  assert.equal(empty.power.typical.status, 'complete');
  assert.equal(empty.power.typical.watts, 0);
});

test('version-one imports and JSON persistence retain power without requiring it in old libraries', () => {
  const powered = normalizePanel(panel({ typical_power_w: 80.5, max_power_w: 200 }));
  const restored = parseLibrary(JSON.stringify({ version: 1, panels: [powered] }));
  assert.deepEqual(restored, [powered]);
  assert.deepEqual(orientPanel(restored[0], true).typical_power_w, 80.5);
  assert.equal(parseLibrary({ version: 1, panels: [panel()] })[0].max_power_w, null);
  assert.throws(() => parseLibrary({ version: 1, panels: [panel(), panel({ id: uuid(2), typical_power_w: -1 })] }), /Panel 2: Typical power/);
  assert.throws(() => calculate(config(), [panel({ max_power_w: Number.MAX_SAFE_INTEGER })]), /Calculated power.*numerical range/);
});
