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
  assert.match(svg, /Left: gap 50 mm · Right: gap 50 mm · Top: gap 50 mm · Bottom: gap 50 mm/);
  const summary = summaryText(result, date);
  assert.match(summary, /Assembly alignment: Center; group origin \(50, 50\) mm/);
  assert.match(summary, /Wall edge gaps: Left: gap 50 mm · Right: gap 50 mm · Top: gap 50 mm · Bottom: gap 50 mm/);
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
  assert.match(svg, /Left: overflow 50 mm · Right: overflow 50 mm · Top: overflow 25 mm · Bottom: overflow 25 mm/);
  assert.match(svg, /stroke="#a62439" stroke-width="2.4" stroke-dasharray="7 4"/);
  const summary = summaryText(result, date);
  assert.match(summary, /group origin \(-50, -25\) mm/);
  assert.match(summary, /Left: overflow 50 mm/);
  assert.ok(!summary.includes('Left: -gap 50 mm'));
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
  assert.match(svg, /Left: gap 150 mm · Right: gap 0 mm · Top: gap 0 mm · Bottom: gap 300 mm/);
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
    assert.ok(summary.includes(`Wall edge gaps: Left: gap ${x} mm · Right: gap ${200-x} mm · Top: gap ${100-y} mm · Bottom: gap ${y} mm`), alignment);
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
  assert.match(summary, /Wall edge gaps: Left: gap 50 mm · Right: gap 50 mm · Top: gap 125 mm · Bottom: gap 125 mm/);
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
    const gaps = `Wall edge gaps: Left: gap ${x} mm · Right: gap ${100-x} mm · Top: gap ${250-y} mm · Bottom: gap ${y} mm`;
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
      if (report) assert.ok(svg.includes('Whole wall power: Typical / average: Partial: 800 W / 0.8 kW known (8 of 16 cabinets)'));
      if (result.compositionLocked) assert.ok(svg.includes('unlock to edit sizing; placement stays editable'));
    }
  }
});

const manual = (overrides = {}) => ({ wall: { name: 'Joined manual assembly', width_mm: 8000, height_mm: 3000 }, mode: 'two_zones', sizingMode: 'manual', arrangement: 'side_by_side', alignment: 'center', zones: [{ panelId: id(9), columns: 4, rows: 4 }, { panelId: id(1), columns: 6, rows: 4 }], ...overrides });
const manualModels = () => [panel({ typical_power_w: 100, max_power_w: 200 }), panel({ id: id(1), name: 'Square B', active_width_mm: 300, active_height_mm: 300, resolution_w: 96, resolution_h: 96 })];
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const tagWith = (svg, tag, attribute, value) => attributes([...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(match => match[0]).find(markup => markup.includes(`${attribute}="${value}"`)) || '');

function verifyGapSegments(svg, result) {
  const wall = tagWith(svg, 'rect', 'data-wall', 'target'), group = tagWith(svg, 'rect', 'data-group', 'assembly');
  const x = Number(wall.x), y = Number(wall.y), w = Number(wall.width), h = Number(wall.height);
  const gx = Number(group.x), gy = Number(group.y), gw = Number(group.width), gh = Number(group.height);
  const scale = w / result.wall.width_mm;
  const expected = { left: [x,gx], right: [gx+gw,x+w], top: [y,gy], bottom: [gy+gh,y+h] };
  const boxes = [];
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.equal((svg.match(/<line [^>]*data-gap-edge=/g) || []).length, 4);
  for (const edge of ['left','right','top','bottom']) {
    const segment = tagWith(svg, 'line', 'data-gap-edge', edge);
    assert.equal(Number(segment['data-gap-mm']), result.group.gaps[edge], edge);
    const horizontal = edge === 'left' || edge === 'right';
    const [a,b] = horizontal ? [Number(segment.x1),Number(segment.x2)] : [Number(segment.y1),Number(segment.y2)];
    assert.ok(Math.abs(a-expected[edge][0]) < 0.002, `${edge} wall/group endpoint ${a}`);
    assert.ok(Math.abs(b-expected[edge][1]) < 0.002, `${edge} wall/group endpoint ${b}`);
    assert.ok(Math.abs(Math.abs(b-a) - Math.abs(result.group.gaps[edge])*scale) < 0.002, edge);
    const label = tagWith(svg, 'rect', 'data-gap-box', edge);
    const box = { x:Number(label.x), y:Number(label.y), w:Number(label.width), h:Number(label.height) };
    assert.ok(box.x >= 0 && box.y >= 0 && box.x+box.w <= viewBox[2] && box.y+box.h <= viewBox[3], edge);
    boxes.push(box);
    const markup = svg.match(new RegExp(`<text data-gap-label="${edge}"[^>]*>(.*?)<\\/text>`))[1].replace(/<[^>]+>/g,'');
    assert.ok(markup.includes(`${result.group.gaps[edge]<0?'overflow':'gap'} `));
    assert.ok(markup.endsWith(' mm'));
  }
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j];
    assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y, 'Side label boxes must not overlap');
  }
  assert.ok(gx>=0 && gy>=0 && gx+gw<=viewBox[2] && gy+gh<=viewBox[3], 'Complete assembly bounds remain inside SVG');
}

test('manual A 4×4 plus B 6×4 reports a joined 4200×1350 frame and real wall-to-group brackets', () => {
  const result = calculate(manual(), manualModels());
  assert.equal(result.totalCount,40);
  assert.deepEqual(result.group.gaps,{left:1900,right:1900,top:825,bottom:825});
  const summary = summaryText(result,date);
  for (const report of [false,true]) {
    const svg = renderDiagram(result,{report,date});
    verifyGapSegments(svg,result);
    assert.ok(svg.includes('Width 4,200 mm'));
    assert.ok(svg.includes('Height 1,350 mm'));
    for (const obsolete of ['Sizing allocation','sizing split','strategy:','Fit inside']) assert.ok(!svg.includes(obsolete),obsolete);
    if (report) { assert.match(svg,/4 × 4 = 16 cabinets/); assert.match(svg,/6 × 4 = 24 cabinets/); assert.match(svg,/Zone power:/); }
    else { assert.ok(!svg.includes('Zone power:'),'Live figure stays concise'); assert.ok(!svg.includes('Counts by SKU:')); }
  }
  assert.match(summary,/Assembly frame bounds: 4,200 × 1,350 mm/);
  assert.match(summary,/Left: gap 1,900 mm · Right: gap 1,900 mm · Top: gap 825 mm · Bottom: gap 825 mm/);
  assert.match(summary,/Packed frame origin: \(1,900, 825\) mm/);
  assert.match(summary,/Packed frame origin: \(4,300, 825\) mm/);
  for (const obsolete of ['Sizing allocation','sizing split','strategy:']) assert.ok(!summary.includes(obsolete),obsolete);
});

test('flush assembly keeps four separate zero-mm bracket labels rather than omitting them', () => {
  const result = calculate(manual({wall:{width_mm:4200,height_mm:1350}}),manualModels());
  assert.deepEqual(result.group.gaps,{left:0,right:0,top:0,bottom:0});
  for (const report of [false,true]) {
    const svg=renderDiagram(result,{report,date});
    verifyGapSegments(svg,result);
    assert.equal((svg.match(/data-gap-mm="0"/g) || []).length,4);
    assert.equal((svg.match(/>gap <\/tspan>/g) || []).length,4);
    assert.equal((svg.match(/>0 mm<\/tspan>/g) || []).length,4);
  }
});

test('all nine placements show correct asymmetric overflow or mixed-axis gap spans without clipping', () => {
  const alignments=['top_left','top_center','top_right','middle_left','center','middle_right','bottom_left','bottom_center','bottom_right'];
  for (const wall of [{width_mm:3000,height_mm:1000},{width_mm:3000,height_mm:3000},{width_mm:8000,height_mm:1000}]) {
    for (const alignment of alignments) {
      const result=calculate(manual({wall,alignment}),manualModels());
      for (const report of [false,true]) {
        const svg=renderDiagram(result,{report,date});
        verifyGapSegments(svg,result);
        assert.ok(svg.includes('overflow'),'At least one side visibly identifies overflow');
        assert.ok(!svg.includes('NaN'));
      }
      const summary=summaryText(result,date);
      for (const edge of ['left','right','top','bottom']) {
        const value=result.group.gaps[edge];
        assert.ok(summary.includes(`${edge[0].toUpperCase()}${edge.slice(1)}: ${value<0?'overflow':'gap'}`));
      }
    }
  }
});

test('manual rotated frames and stacked arrangement keep frame extents and projected dimension lines', () => {
  const models=manualModels();
  for (const arrangement of ['side_by_side','stacked']) {
    const result=calculate(manual({arrangement,zones:[{panelId:id(9),columns:4,rows:4,rotated:true},{panelId:id(1),columns:6,rows:4}]}),models);
    assert.equal(result.zones[0].actualWidth,1350);
    assert.equal(result.zones[0].actualHeight,2400);
    const svg=renderDiagram(result,{report:true,date});
    verifyGapSegments(svg,result);
    assert.match(svg,/Frame 337.5 × 600 mm/);
    assert.ok(!svg.includes('Sizing allocation'));
    assert.ok(summaryText(result,date).includes('90° clockwise'));
  }
});

test('legacy automatic fit keeps sizing evidence while the live figure prioritizes physical clearances', () => {
  const result=calculate(config(),[panel()]);
  assert.equal(result.sizingMode,'auto_fit');
  assert.match(summaryText(result,date),/Sizing allocation: 2,400 × 1,350 mm/);
  assert.match(renderDiagram(result,{report:true,date}),/Sizing allocation 2,400 × 1,350 mm/);
  const live=renderDiagram(result,{date});
  verifyGapSegments(live,result);
  assert.ok(!live.includes('Sizing allocation'));
  assert.ok(!live.includes('Zone power:'));
});
