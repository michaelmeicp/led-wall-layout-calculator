import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../core.js';
import { renderDiagram, summaryText } from '../diagram.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const panel = (overrides = {}) => ({ id: id(9), name: 'Example panel', active_width_mm: 600, active_height_mm: 337.5, resolution_w: 192, resolution_h: 108, rotatable: true, ...overrides });
const config = (overrides = {}) => ({ wall: { name: 'Example wall', width_mm: 2400, height_mm: 1350 }, mode: 'single', strategy: 'fit_inside', zones: [{ panelId: id(9), rotated: false }], ...overrides });
const date = new Date('2026-10-28T12:00:00Z');
const texts = (svg, size) => [...svg.matchAll(new RegExp(`<text\\b[^>]*font-size="${size}"[^>]*>([^<]*)<\\/text>`, 'g'))].map((m) => m[1]);

test('SVG escapes names and warning text while plain summary preserves original text', () => {
  const name = 'Fake <script>"&\' panel';
  const result = calculate(config({ wall: { name, width_mm: 2400, height_mm: 1350 } }), [panel({ name, pixel_pitch_mm: 5 })]);
  const svg = renderDiagram(result, { report: true, date });
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('undefined'));
  assert.match(svg, /&lt;script&gt;&quot;&amp;&apos;/);
  assert.ok(summaryText(result, date).includes(name));
  assert.match(svg, /2026-10-28 UTC/);
});

test('one-million-cabinet diagram keeps detail bounded without changing results', () => {
  const result = calculate(config({ wall: { width_mm: 300000, height_mm: 300000 } }), [panel({ active_width_mm: 300, active_height_mm: 300, resolution_w: 100, resolution_h: 100 })]);
  assert.equal(result.totalCount, 1_000_000);
  const svg = renderDiagram(result, { date });
  assert.ok(svg.length < 20_000, `SVG unexpectedly grew to ${svg.length} characters`);
  assert.ok((svg.match(/<rect /g) || []).length < 100);
  assert.match(svg, /Dense grid/);
  assert.match(svg, /1,000,000 cabinets/);
});

test('SKU colors follow selection order and the same SKU stays the same color', () => {
  const result = calculate(config({ mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: id(9) }, { panelId: id(1) }] }), [panel(), panel({ id: id(1), name: 'Second selected' })]);
  const svg = renderDiagram(result, { date });
  assert.equal(svg.match(/fill="(#[a-f0-9]+)" stroke="#[a-f0-9]+" stroke-width="0.8"/)[1], '#e3efed');
  assert.match(svg, /fill="#f3e9df" stroke="#9c6643" stroke-width="0.8"/);
  const oneSku = calculate(config({ mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1200 }, zones: [{ panelId: id(9) }, { panelId: id(9) }] }), [panel()]);
  assert.ok(!renderDiagram(oneSku, { date }).includes('#9c6643'));
});

for (const name of ['W'.repeat(160), '牆'.repeat(160), '🧱'.repeat(80)]) {
  test(`report retains full maximal wide-glyph wall/model names (${name.slice(0, 2)})`, () => {
    const result = calculate(config({ wall: { name, width_mm: 2400, height_mm: 1350 } }), [panel({ name, pixel_pitch_mm: 5 })]);
    const svg = renderDiagram(result, { report: true, date });
    const titleLines = texts(svg, 26);
    assert.equal(titleLines.join(''), name);
    assert.ok(titleLines.length >= 3, 'Wide title should wrap to multiple readable lines');
    const boldBody = texts(svg, 15).join('');
    assert.ok(boldBody.includes(name), 'Full panel name must remain in report body');
    assert.ok(texts(svg, 13).join('').includes(name), 'Full panel name must remain in warnings/counts');
    assert.match(svg, /width="1800"/);
    assert.ok(!svg.includes('NaN'));
  });
}

test('summary and report distinguish physical active extent from pixel aspect', () => {
  const result = calculate(config(), [panel({ active_width_mm: 580, active_height_mm: 317.5, frame_width_mm: 600, frame_height_mm: 337.5 })]);
  const summary = summaryText(result, date);
  assert.match(summary, /active extent aspect: 1.7895:1; pixel aspect: 1.7778:1/);
  const svg = renderDiagram(result, { report: true, date });
  assert.match(svg, /LED active extent aspect 1.7895:1/);
  assert.match(svg, /LED pixel aspect 1.7778:1/);
});

test('diagram and summary preserve centered frame origins and all four edge gaps', () => {
  const result = calculate(config({ wall: { width_mm: 2500, height_mm: 1450 }, alignment: 'center', zones: [{ panelId: id(9) }] }), [panel()]);
  const svg = renderDiagram(result, { report: true, date });
  assert.match(svg, /data-frame-x-mm="50" data-frame-y-mm="50"/);
  assert.match(svg, /Assembly alignment: Center/);
  assert.match(svg, /Left: 50 mm gap · Right: 50 mm gap · Top: 50 mm gap · Bottom: 50 mm gap/);
  const summary = summaryText(result, date);
  assert.match(summary, /Assembly alignment: Center; group origin \(50, 50\) mm/);
  assert.match(summary, /Wall edge gaps: Left: 50 mm gap · Right: 50 mm gap · Top: 50 mm gap · Bottom: 50 mm gap/);
});

test('all corner diagrams draw from the selected physical frame origin', () => {
  const cases = { top_left: [0,100], top_right: [100,100], bottom_left: [0,0], bottom_right: [100,0] };
  for (const [alignment, [x,y]] of Object.entries(cases)) {
    const result = calculate(config({ wall: { width_mm: 2500, height_mm: 1450 }, alignment, zones: [{ panelId: id(9) }] }), [panel()]);
    const svg = renderDiagram(result, { date });
    assert.ok(svg.includes(`data-frame-x-mm="${x}" data-frame-y-mm="${y}"`), alignment);
    assert.ok(!svg.includes('undefined'), alignment);
  }
});

test('center cover report labels overflow on each affected edge and keeps negative origins visible', () => {
  const result = calculate(config({ wall: { width_mm: 2300, height_mm: 1300 }, strategy: 'cover_wall', alignment: 'center', zones: [{ panelId: id(9) }] }), [panel()]);
  const svg = renderDiagram(result, { report: true, date });
  assert.match(svg, /data-frame-x-mm="-50" data-frame-y-mm="-25"/);
  assert.match(svg, /Left: 50 mm overflow · Right: 50 mm overflow · Top: 25 mm overflow · Bottom: 25 mm overflow/);
  assert.match(svg, /stroke="#a62439" stroke-width="1.7" stroke-dasharray="6 3"/);
  const summary = summaryText(result, date);
  assert.match(summary, /group origin \(-50, -25\) mm/);
  assert.match(summary, /Left: 50 mm overflow/);
  assert.ok(!summary.includes('Left: -50 mm gap'));
});

test('reports show supplied power by zone, SKU and wall with unknown or partial totals', () => {
  const result = calculate(config({ wall: { width_mm: 2600, height_mm: 1450 }, mode: 'two_zones', split: { direction: 'vertical', offset_mm: 1300 }, alignment: 'top_right', zones: [{ panelId: id(9) }, { panelId: id(1) }] }), [panel({ typical_power_w: 100, max_power_w: 250 }), panel({ id: id(1), name: 'Unknown cabinet' })]);
  const summary = summaryText(result, date);
  assert.match(summary, /Zone power: Typical \/ average: 800 W \/ 0.8 kW · Maximum: 2,000 W \/ 2 kW/);
  assert.match(summary, /Zone power: Typical \/ average: Unknown/);
  assert.match(summary, /Whole wall power: Typical \/ average: Partial/);
  assert.match(summary, /Counts by SKU:/);
  assert.match(summary, /Example panel.*800 W \/ 0.8 kW/);
  const svg = renderDiagram(result, { report: true, date });
  for (const phrase of ['Whole wall power:', 'Partial', 'Unknown', 'SKU power', 'Top right']) assert.ok(svg.includes(phrase), phrase);
  assert.ok(!svg.includes('NaN'));
});

test('rotated frame with active insets retains alignment, gaps and wattage in exports', () => {
  const result = calculate(config({ wall: { width_mm: 1500, height_mm: 1500 }, alignment: 'top_right', zones: [{ panelId: id(9), rotated: true }] }), [panel({ active_width_mm: 580, active_height_mm: 317.5, frame_width_mm: 600, frame_height_mm: 337.5, typical_power_w: 100, max_power_w: 200 })]);
  const svg = renderDiagram(result, { report: true, date });
  assert.match(svg, /data-frame-x-mm="150" data-frame-y-mm="300"/);
  assert.match(svg, /Frame 337.5 × 600 mm/);
  assert.match(svg, /Active 317.5 × 580 mm/);
  assert.match(svg, /Left: 150 mm gap · Right: 0 mm gap · Top: 0 mm gap · Bottom: 300 mm gap/);
  assert.match(summaryText(result,date), /800 W \/ 0.8 kW/);
});


test('all placements move an unequal-height vertical assembly together with one set of wall gaps', () => {
  const cases = { top_left: [0,100], top_center: [100,100], top_right: [200,100], middle_left: [0,50], center: [100,50], middle_right: [200,50], bottom_left: [0,0], bottom_center: [100,0], bottom_right: [200,0] };
  const models = [panel({ typical_power_w: 100, max_power_w: 200 }), panel({ id: id(1), name: 'Square block', active_width_mm: 400, active_height_mm: 300, resolution_w: 128, resolution_h: 96, typical_power_w: 75, max_power_w: 150 })];
  for (const [alignment, [x,y]] of Object.entries(cases)) {
    const result = calculate(config({ wall: { width_mm: 2600, height_mm: 1450 }, mode: 'two_zones', alignment, split: { direction: 'vertical', offset_mm: 1300 }, zones: [{ panelId: id(9) }, { panelId: id(1) }] }), models);
    const svg = renderDiagram(result, { report: true, date });
    assert.ok(svg.includes(`data-group-x-mm="${x}" data-group-y-mm="${y}"`), alignment);
    assert.ok(svg.includes(`data-zone="0" data-frame-x-mm="${x}" data-frame-y-mm="${y}"`), alignment);
    assert.ok(svg.includes(`data-zone="1" data-frame-x-mm="${x+1200}" data-frame-y-mm="${y}"`), alignment);
    const summary = summaryText(result, date);
    assert.equal((summary.match(/Assembly alignment:/g) || []).length, 1);
    assert.equal((summary.match(/Wall edge gaps:/g) || []).length, 1);
    assert.ok(summary.includes(`Wall edge gaps: Left: ${x} mm gap · Right: ${200-x} mm gap · Top: ${100-y} mm gap · Bottom: ${y} mm gap`), alignment);
    assert.ok(summary.includes('Assembly frame bounds: 2,400 × 1,350 mm'), alignment);
    assert.ok(summary.includes('bottom edges align. Unequal heights create a step.'), alignment);
    for (const obsolete of ['Alignment applies independently', 'Frame edge gaps:', 'overlaps', 'crosses the split']) assert.ok(!summary.includes(obsolete), obsolete);
    assert.ok(!svg.includes('overlap-hatch'));
    assert.ok(!svg.includes('stroke="#a82e46"'), 'Sizing cut must not look like a fixed physical seam');
    assert.equal(result.zones[0].actualX + result.zones[0].actualWidth, result.zones[1].actualX);
  }
});

test('horizontal unequal-width assembly reports sizing allocations separately from packed origins', () => {
  const result = calculate(config({ wall: { width_mm: 2500, height_mm: 2800 }, mode: 'two_zones', alignment: 'center', split: { direction: 'horizontal', offset_mm: 1400 }, zones: [{ panelId: id(9) }, { panelId: id(1) }] }), [panel(), panel({ id: id(1), name: 'Upper block', active_width_mm: 550, active_height_mm: 300, resolution_w: 176, resolution_h: 96 })]);
  const summary = summaryText(result, date);
  const svg = renderDiagram(result, { report: true, date });
  assert.match(svg, /data-group-x-mm="50" data-group-y-mm="125"/);
  assert.match(svg, /data-zone="0" data-frame-x-mm="50" data-frame-y-mm="125"/);
  assert.match(svg, /data-zone="1" data-frame-x-mm="50" data-frame-y-mm="1475"/);
  assert.match(summary, /Assembly frame bounds: 2,400 × 2,550 mm/);
  assert.match(summary, /Wall edge gaps: Left: 50 mm gap · Right: 50 mm gap · Top: 125 mm gap · Bottom: 125 mm gap/);
  assert.match(summary, /Horizontal sizing split · 1,400 mm from BOTTOM/);
  assert.match(summary, /Sizing allocation: 2,500 × 1,400 mm/);
  assert.match(summary, /Packed frame origin: \(50, 1,475\) mm/);
  assert.ok(svg.includes('left edges align. Unequal widths create a step.'));
  assert.ok(!svg.includes('undefined'));
});


test('all nine placements preserve joined horizontal blocks and export whole-assembly wall gaps', () => {
  const cases = { top_left: [0,250], top_center: [50,250], top_right: [100,250], middle_left: [0,125], center: [50,125], middle_right: [100,125], bottom_left: [0,0], bottom_center: [50,0], bottom_right: [100,0] };
  const names = { top_left: 'Top left', top_center: 'Top center', top_right: 'Top right', middle_left: 'Left center', center: 'Center', middle_right: 'Right center', bottom_left: 'Bottom left', bottom_center: 'Bottom center', bottom_right: 'Bottom right' };
  for (const [alignment, [x,y]] of Object.entries(cases)) {
    const result = calculate(config({ wall: { width_mm: 2500, height_mm: 2800 }, mode: 'two_zones', alignment, split: { direction: 'horizontal', offset_mm: 1400 }, zones: [{ panelId: id(9) }, { panelId: id(1) }] }), [panel(), panel({ id: id(1), name: 'Upper block', active_width_mm: 550, active_height_mm: 300, resolution_w: 176, resolution_h: 96 })]);
    const summary = summaryText(result, date);
    const svg = renderDiagram(result, { report: true, date });
    const gaps = `Wall edge gaps: Left: ${x} mm gap · Right: ${100-x} mm gap · Top: ${250-y} mm gap · Bottom: ${y} mm gap`;
    assert.ok(svg.includes(`data-group-x-mm="${x}" data-group-y-mm="${y}"`), alignment);
    assert.ok(svg.includes(`data-zone="0" data-frame-x-mm="${x}" data-frame-y-mm="${y}"`), alignment);
    assert.ok(svg.includes(`data-zone="1" data-frame-x-mm="${x}" data-frame-y-mm="${y+1350}"`), alignment);
    assert.ok(summary.includes(gaps), alignment);
    assert.ok(svg.includes(gaps), alignment);
    assert.ok(summary.includes(`Assembly alignment: ${names[alignment]}`), alignment);
    assert.ok(svg.includes(`Assembly alignment: ${names[alignment]}`), alignment);
    assert.equal((summary.match(/Wall edge gaps:/g) || []).length, 1);
    assert.equal(result.zones[0].actualY + result.zones[0].actualHeight, result.zones[1].actualY);
  }
});

test('composition lock status appears in summary, live diagram and PNG report without changing power or geometry', () => {
  const raw = config({ wall: { width_mm: 2600, height_mm: 1450 }, mode: 'two_zones', alignment: 'top_center', split: { direction: 'vertical', offset_mm: 1300 }, zones: [{ panelId: id(9) }, { panelId: id(1) }] });
  const models = [panel({ typical_power_w: 100, max_power_w: 250 }), panel({ id: id(1), name: 'Unknown cabinet' })];
  const unlocked = calculate(raw, models);
  const locked = calculate({ ...raw, compositionLocked: true }, models);
  assert.equal(unlocked.compositionLocked, false);
  assert.equal(locked.compositionLocked, true);
  assert.deepEqual(locked.group, unlocked.group);
  assert.deepEqual(locked.power, unlocked.power);
  for (const [result, status] of [[unlocked, 'Unlocked'], [locked, 'Locked']]) {
    assert.ok(summaryText(result, date).includes(`Composition: ${status}`));
    for (const report of [false, true]) {
      const svg = renderDiagram(result, { report, date });
      assert.ok(svg.includes(`Composition: ${status}`));
      assert.ok(svg.includes('Whole wall power: Typical / average: Partial: 800 W / 0.8 kW known (8 of 16 cabinets)'));
      if (result.compositionLocked) assert.ok(svg.includes('unlock to edit sizing; placement stays editable'));
    }
  }
});
