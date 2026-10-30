import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePanel, parseLibrary, orientPanel, calculate, alignmentName, gapText, powerText, resolveAlignment } from '../core.js';

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

test('one whole-assembly alignment controls center and all corners using cabinet frames', () => {
  const positions = {
    center: [50, 25, { left: 50, right: 50, top: 25, bottom: 25 }],
    top_left: [0, 50, { left: 0, right: 100, top: 0, bottom: 50 }],
    top_right: [100, 50, { left: 100, right: 0, top: 0, bottom: 50 }],
    bottom_left: [0, 0, { left: 0, right: 100, top: 50, bottom: 0 }],
    bottom_right: [100, 0, { left: 100, right: 0, top: 50, bottom: 0 }],
  };
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
  assert.equal(gapText(25), '25 mm gap');
  assert.equal(gapText(-25), '25 mm overflow');
});

test('global alignment migration validates one choice and ignores obsolete second-zone choices', () => {
  assert.equal(resolveAlignment(config()), 'bottom_left', 'V1 session fallback');
  assert.equal(resolveAlignment(config({ zones: [{ panelId: uuid(1), alignment: 'top_right' }] })), 'top_right', 'V1.1 first-zone migration');
  const cfg = config({ mode: 'two_zones', alignment: 'center', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: uuid(1), alignment: 'bad' }, { panelId: uuid(1), alignment: 'also bad' }] });
  assert.equal(calculate(cfg, [panel()]).alignment, 'center', 'explicit global selection wins');
  assert.equal(calculate({ ...cfg, alignment: undefined, zones: [{ panelId: uuid(1), alignment: 'top_left' }, cfg.zones[1]] }, [panel()]).alignment, 'top_left');
  for (const alignment of ['middle_left', '', null, false, 0, {}]) assert.throws(() => calculate(config({ alignment }), [panel()]), /valid alignment/);
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

test('unequal vertical and horizontal zones remain one rigid joined silhouette for all five alignments', () => {
  const other = panel({ id: uuid(2), active_width_mm: 350, active_height_mm: 300, resolution_w: 112, resolution_h: 96 });
  for (const direction of ['vertical', 'horizontal']) {
    const cfg = config({ wall: { width_mm: 2500, height_mm: 1400 }, mode: 'two_zones', split: { direction, offset_mm: direction === 'vertical' ? 1250 : 700 }, zones: [{ panelId: uuid(1) }, { panelId: uuid(2) }] });
    const baseline = calculate({ ...cfg, alignment: 'bottom_left' }, [panel(), other]);
    const expectedSize = direction === 'vertical' ? [2250, 1350] : [2450, 1275];
    assert.deepEqual([baseline.group.width, baseline.group.height], expectedSize);
    for (const alignment of ['center', 'top_left', 'top_right', 'bottom_left', 'bottom_right']) {
      const r = calculate({ ...cfg, alignment }, [panel(), other]);
      const [a, b] = r.zones;
      assert.deepEqual(r.zones.map(z => z.count), baseline.zones.map(z => z.count));
      assert.deepEqual([r.group.width, r.group.height], expectedSize);
      assert.deepEqual([a.actualX - r.group.x, a.actualY - r.group.y], [0, 0]);
      assert.deepEqual([b.actualX - r.group.x, b.actualY - r.group.y], direction === 'vertical' ? [a.actualWidth, 0] : [0, a.actualHeight]);
      assert.equal(direction === 'vertical' ? a.actualX + a.actualWidth : a.actualY + a.actualHeight, direction === 'vertical' ? b.actualX : b.actualY, 'no internal gap or overlap');
      const expectedX = alignment === 'center' ? r.group.deltaW / 2 : alignment.endsWith('right') ? r.group.deltaW : 0;
      const expectedY = alignment === 'center' ? r.group.deltaH / 2 : alignment.startsWith('top') ? r.group.deltaH : 0;
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
