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
