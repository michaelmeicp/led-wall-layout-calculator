// Self-contained SVG reporting. No network fonts, images, or runtime dependencies.
import { ALIGNMENTS, gapText, powerText } from './core.js';
const PALETTE = [
  { line: '#276b68', fill: '#e3efed', active: '#acd2cc' },
  { line: '#9c6643', fill: '#f3e9df', active: '#dfbf9f' },
];
const INK = '#182b3a';
const MUTED = '#4c6070';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export const formatNumber = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(value)) : '—';
const f = formatNumber;
const rounded = (n) => Math.round(n * 1000) / 1000;
const orientation = (z) => z.rotated ? '↻ 90°' : '↑ 0°';
const alignmentName = (group) => ALIGNMENTS[group.alignment] || group.alignment;
const compositionLine = (result) => result.compositionLocked
  ? 'Composition: Locked · unlock to edit sizing; placement stays editable'
  : 'Composition: Unlocked';
const powerLine = (power) => `Typical / average: ${powerText(power.typical)} · Maximum: ${powerText(power.maximum)}`;
const gapLine = (z) => ['left', 'right', 'top', 'bottom'].map((edge) => `${edge[0].toUpperCase()}${edge.slice(1)}: ${gapText(z.gaps[edge])}`).join(' · ');
const ratio = (w, h) => w > 0 && h > 0 ? `${f(w / h, 4)}:1` : '—';
const strategyName = (s) => ({ fit_inside: 'Fit inside', cover_wall: 'Cover wall', exact_only: 'Exact only' }[s] || s);

// Conservative advance estimates for the local Arial/Helvetica font stack.
// Wide Latin capitals, CJK, and emoji must not be treated as narrow ASCII.
// Keeping this pure also makes exported reports deterministic in Node tests.
function estimatedWidth(value, size = 14, bold = false) {
  let em = 0;
  for (const char of String(value)) {
    if (/[\p{Mark}\u200d\ufe0e\ufe0f]/u.test(char)) continue;
    if (/\s/u.test(char)) em += 0.36;
    else if (/[WM@%]/.test(char)) em += 1.06;
    else if (/[A-Z]/.test(char)) em += 0.83;
    else if (/[mw]/.test(char)) em += 0.94;
    else if (/[ilI1.,:;'!|]/.test(char)) em += 0.39;
    else if (/[a-z0-9]/.test(char)) em += 0.65;
    else if (char.codePointAt(0) > 127) em += 1.15;
    else em += 0.7;
  }
  return em * size * (bold ? 1.04 : 1);
}

function shorten(value, width, size = 14, bold = false) {
  const characters = Array.from(String(value ?? ''));
  if (estimatedWidth(value, size, bold) <= width) return String(value ?? '');
  while (characters.length && estimatedWidth(characters.join('') + '…', size, bold) > width) characters.pop();
  return characters.join('') + '…';
}

function wrap(text, width, size = 14, bold = false) {
  const result = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && estimatedWidth(`${line} ${word}`, size, bold) <= width) {
        line += ` ${word}`;
        continue;
      }
      if (line) { result.push(line); line = ''; }
      for (const character of Array.from(word)) {
        if (line && estimatedWidth(line + character, size, bold) > width) {
          result.push(line);
          line = '';
        }
        line += character;
      }
    }
    result.push(line);
  }
  return result;
}

function allWarnings(result) {
  const items = [...(result.warnings || [])];
  for (const zone of result.zones) {
    for (const w of zone.warnings || []) {
      if (!items.some((item) => item.message === w.message)) items.push(w);
    }
  }
  return items;
}

function colorsFor(result) {
  const ids = [...new Set(result.zones.map((z) => z.panel.id))];
  return new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}

function activeExtents(zone) {
  if (!zone.count) return { width: 0, height: 0 };
  return {
    width: (zone.nx - 1) * zone.panel.frame_width_mm + zone.panel.active_width_mm,
    height: (zone.ny - 1) * zone.panel.frame_height_mm + zone.panel.active_height_mm,
  };
}

function splitDescription(result) {
  if (result.sizingMode === 'manual') return `Manual cabinet counts · ${result.mode === 'single' ? 'Single panel type' : result.arrangement === 'stacked' ? 'Stacked A / B' : 'Side by side A / B'}`;
  if (result.mode !== 'two_zones') return 'Single panel type';
  return result.split.direction === 'vertical'
    ? `Vertical sizing split · ${f(result.split.offset_mm)} mm from LEFT · A / B sizing allocations`
    : `Horizontal sizing split · ${f(result.split.offset_mm)} mm from BOTTOM · A / B sizing allocations`;
}

function packingDescription(result) {
  if (result.mode !== 'two_zones') return 'Single cabinet block';
  return result.group.packing === 'vertical'
    ? 'Packed assembly: A left / B right, cabinet frames touch; bottom edges align. Unequal heights create a step.'
    : 'Packed assembly: A bottom / B top, cabinet frames touch; left edges align. Unequal widths create a step.';
}

export function summaryText(result, date = new Date()) {
  const wall = result.wall;
  const group = result.group;
  const lines = [
    'LED WALL PANEL LAYOUT',
    wall.name || 'Untitled wall',
    `Date: ${date.toISOString().slice(0, 10)} (UTC)`,
    `Target: ${f(wall.width_mm)} × ${f(wall.height_mm)} mm; aspect ${ratio(wall.width_mm, wall.height_mm)}`,
    `Mode: ${result.mode === 'two_zones' ? 'Two zones' : 'Single zone'}; ${result.sizingMode === 'manual' ? 'manual cabinet counts' : `strategy: ${strategyName(result.strategy)}`}`,
    splitDescription(result),
    packingDescription(result),
    compositionLine(result),
    'Alignment moves the complete assembly together; +X right, +Y up. Gaps measure full-wall edges to the assembly bounding box; negative clearance is overflow. Active areas are centered in frames.',
    `Assembly alignment: ${alignmentName(group)}; group origin (${f(group.x)}, ${f(group.y)}) mm from wall bottom-left`,
    `Assembly frame bounds: ${f(group.width)} × ${f(group.height)} mm`,
    `Wall edge gaps: ${gapLine(group)}${group.hasCabinets ? '' : ' (no cabinets installed)'}`,
    result.mode === 'two_zones' && result.sizingMode !== 'manual' ? 'The sizing split determines cabinet counts; it is not a fixed physical seam or assembly anchor.' : '',
    '',
  ];
  result.zones.forEach((z, i) => {
    const active = activeExtents(z);
    lines.push(
      `${String.fromCharCode(65 + i)} · ${z.label}`,
      `Model: ${z.panel.name}; orientation: ${z.rotated ? '90° clockwise' : '0° / native'}`,
      ...(result.sizingMode === 'manual' ? [] : [`Sizing allocation: ${f(z.width)} × ${f(z.height)} mm`]),
      `Packed frame origin: (${f(z.actualX)}, ${f(z.actualY)}) mm from wall bottom-left`,
      `Cabinet: frame ${f(z.panel.frame_width_mm)} × ${f(z.panel.frame_height_mm)} mm; active ${f(z.panel.active_width_mm)} × ${f(z.panel.active_height_mm)} mm; ${f(z.panel.resolution_w, 0)} × ${f(z.panel.resolution_h, 0)} px`,
      `Grid: ${f(z.nx, 0)} × ${f(z.ny, 0)} = ${f(z.count, 0)} cabinets`,
      `Per-zone resolution: ${f(z.resolutionW, 0)} × ${f(z.resolutionH, 0)} px`,
      `Actual frame footprint: ${f(z.actualWidth)} × ${f(z.actualHeight)} mm`,
      `Zone power: ${powerLine(z.power)}`,
      `${result.sizingMode === 'manual' ? '' : `Frame area / sizing allocation: ${f(z.utilization * 100)}%; `}active extent aspect: ${ratio(active.width, active.height)}; pixel aspect: ${ratio(z.resolutionW, z.resolutionH)}`,
      '',
    );
  });
  lines.push(`Total: ${f(result.totalCount, 0)} cabinets`, 'Counts by SKU:');
  for (const c of result.counts || []) lines.push(`- ${c.name} [${c.panelId}]: ${f(c.count, 0)} cabinets; ${powerLine(c.power)}`);
  lines.push(`Whole wall power: ${powerLine(result.power)}`);
  lines.push(`Installed frame area / wall area: ${f(result.utilization * 100)}%`);
  lines.push(result.canvas?.combined
    ? `Combined canvas: ${f(result.canvas.width, 0)} × ${f(result.canvas.height, 0)} px. ${result.canvas.reason || ''}`
    : `Processor mapping / separate canvases: ${result.canvas?.reason || 'Use the per-zone resolutions.'}`);
  lines.push('', 'Warnings:');
  const warnings = allWarnings(result);
  if (!warnings.length) lines.push('None.');
  else warnings.forEach((w) => lines.push(`- ${String(w.level || 'amber').toUpperCase()}: ${w.message}`));
  lines.push('', 'Active extent spans the outer lit edges, including gaps between cabinets.', 'Power totals multiply supplied per-panel wattage by installed cabinet count; missing ratings remain unknown or partial. Confirm product dimensions, ratings and processor mapping before installation.');
  return lines.join('\n');
}

export function renderDiagram(result, { report = false, date = new Date() } = {}) {
  const W = 1000;
  const wall = result.wall, zones = result.zones, group = result.group;
  const colors = colorsFor(result);
  const titleLines = report ? wrap(wall.name || 'Untitled wall', W - 68, 26, true)
    : [shorten(wall.name || 'Untitled wall', W - 68, 26, true)];
  const titleExtra = (titleLines.length - 1) * 29;
  const subtitleLines = wrap(`WALL · Width ${f(wall.width_mm)} mm · Height ${f(wall.height_mm)} mm`, W - 68, 19, true);
  const headerExtra = titleExtra + (subtitleLines.length - 1) * 25;
  const maxX = Math.max(wall.width_mm, group.x + group.width), maxY = Math.max(wall.height_mm, group.y + group.height);
  const minX = Math.min(0, group.x), minY = Math.min(0, group.y);

  // Four reserved label boxes keep even flush/overflow labels apart. Only the
  // numerical bracket span is scaled; text is never squeezed into a tiny gap.
  const labelSpec = (edge) => {
    const value = group.gaps[edge], number = gapText(value).replace(/^(gap|overflow) /, '');
    const width = edge === 'top' || edge === 'bottom' ? 260 : 200;
    const numberSize = [40, 32, 24].find(size => estimatedWidth(number, size, true) <= width - 20) || 24;
    const numberLines = []; let current = '';
    for (const char of number) {
      if (current && estimatedWidth(current + char, numberSize, true) > width - 20) { numberLines.push(current); current = ''; }
      current += char;
    }
    if (current) numberLines.push(current);
    return { edge, value, numberSize, numberLines, width, height: 74 + numberLines.length * (numberSize + 7) };
  };
  const labels = Object.fromEntries(['left','right','top','bottom'].map(edge => [edge,labelSpec(edge)]));
  const plot = { x: 220, y: 118 + headerExtra + labels.top.height + 22, w: 560, h: 330 };
  const scale = Math.min(plot.w / (maxX - minX || 1), plot.h / (maxY - minY || 1));
  const ox = plot.x + (plot.w - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = plot.y + (plot.h + (maxY - minY) * scale) / 2 + minY * scale;
  const X = (x) => rounded(ox + x * scale), Y = (y) => rounded(oy - y * scale), S = (n) => rounded(n * scale);
  const text = (x, y, value, size = 14, extra = '') => `<text x="${rounded(x)}" y="${rounded(y)}" font-size="${size}" ${extra}>${esc(value)}</text>`;
  const rect = (x, y, w, h, extra = '') => `<rect x="${rounded(x)}" y="${rounded(y)}" width="${rounded(Math.max(0, w))}" height="${rounded(Math.max(0, h))}" ${extra}/>`;
  const line = (x1, y1, x2, y2, extra = '') => `<line x1="${rounded(x1)}" y1="${rounded(y1)}" x2="${rounded(x2)}" y2="${rounded(y2)}" ${extra}/>`;
  const parts = [], defs = [];
  const paragraph = (x, y, value, size = 14, extra = '', lineHeight = Math.ceil(size * 1.5)) => {
    const lines = wrap(value, W - x - 34, size, extra.includes('font-weight="700"'));
    lines.forEach((value, i) => parts.push(text(x, y + i * lineHeight, value, size, extra)));
    return lines.length * lineHeight;
  };
  let reducedDetail = false;
  parts.push(text(34, 32, 'LED WALL  /  JOINED ASSEMBLY', 14, 'font-weight="700" letter-spacing="1.5" fill="#276b68"'));
  titleLines.forEach((label, i) => parts.push(text(34, 65 + i * 29, label, 26, 'font-weight="700"')));
  subtitleLines.forEach((label, i) => parts.push(text(34, 94 + titleExtra + i * 25, label, 19, 'font-weight="700"')));
  parts.push(text(W - 34, 32, date.toISOString().slice(0, 10) + ' UTC', 12, `text-anchor="end" fill="${MUTED}"`));
  parts.push(rect(X(0), Y(wall.height_mm), S(wall.width_mm), S(wall.height_mm), 'fill="#f3f5f7"'));
  zones.forEach((z, i) => {
    const c = colors.get(z.panel.id);
    const fw = S(z.panel.frame_width_mm), fh = S(z.panel.frame_height_mm);
    const aw = S(z.panel.active_width_mm), ah = S(z.panel.active_height_mm);
    const x = X(z.actualX), y = Y(z.actualY + z.actualHeight);
    const w = S(z.actualWidth), h = S(z.actualHeight);
    const key = `zone-${i}`;
    if (z.count > 0 && w > 0 && h > 0) {
      const detailed = z.count <= 1200 && fw >= 8 && fh >= 8;
      if (detailed) {
        for (let row = 0; row < z.ny; row++) {
          for (let col = 0; col < z.nx; col++) {
            const cx = x + col * fw, cy = y + row * fh;
            parts.push(rect(cx, cy, fw, fh, `fill="${c.fill}" stroke="${c.line}" stroke-width="0.8"`));
            if (aw < fw - 0.2 || ah < fh - 0.2) {
              parts.push(rect(cx + (fw - aw) / 2, cy + (fh - ah) / 2, aw, ah, `fill="${c.active}" stroke="${c.line}" stroke-width="0.45"`));
            }
            if (report && fw >= 80 && fh >= 52 && z.count <= 180) {
              parts.push(text(cx + fw / 2, cy + fh / 2 - 3, shorten(z.panel.name, fw - 16, 10), 10, `text-anchor="middle" fill="${INK}"`));
              parts.push(text(cx + fw / 2, cy + fh / 2 + 12, orientation(z), 10, `text-anchor="middle" fill="${c.line}"`));
            }
          }
        }
      } else {
        reducedDetail = true;
        if (fw >= 3 && fh >= 3) {
          defs.push(`<pattern id="${key}-pattern" x="0" y="0" width="${fw}" height="${fh}" patternUnits="userSpaceOnUse" patternTransform="translate(${x} ${y})">${rect(0, 0, fw, fh, `fill="${c.fill}" stroke="${c.line}" stroke-width="0.65"`)}${aw < fw - 0.2 || ah < fh - 0.2 ? rect((fw - aw) / 2, (fh - ah) / 2, aw, ah, `fill="${c.active}" stroke="${c.line}" stroke-width="0.4"`) : ''}</pattern>`);
          parts.push(rect(x, y, w, h, `fill="url(#${key}-pattern)"`));
        } else {
          parts.push(rect(x, y, w, h, `fill="${c.fill}"`));
          // Coarse sample lines are explicitly labeled, never used for counts.
          const columns = Math.min(24, z.nx), rows = Math.min(18, z.ny);
          for (let col = 1; col < columns; col++) parts.push(line(x + w * col / columns, y, x + w * col / columns, y + h, `stroke="${c.line}" stroke-opacity="0.25" stroke-width="0.5"`));
          for (let row = 1; row < rows; row++) parts.push(line(x, y + h * row / rows, x + w, y + h * row / rows, `stroke="${c.line}" stroke-opacity="0.25" stroke-width="0.5"`));
        }
      }
      parts.push(rect(x, y, w, h, `data-zone="${i}" data-frame-x-mm="${z.actualX}" data-frame-y-mm="${z.actualY}" fill="none" stroke="${c.line}" stroke-width="1.6"`));
    }
    // Letter badges identify the installed blocks, independent of sizing allocations.
    if (z.count && w >= 30 && h >= 30) {
      const badgeX = x + 5, badgeY = y + 5;
      parts.push(rect(badgeX, badgeY, 23, 23, `rx="4" fill="#fff" stroke="${c.line}" stroke-width="1.5"`));
      parts.push(text(badgeX + 11.5, badgeY + 16, String.fromCharCode(65 + i), 14, `text-anchor="middle" font-weight="700" fill="${c.line}"`));
    }
  });
  if (group.hasCabinets) {
    const overflow = Object.values(group.gaps).some(value => value < 0);
    parts.push(rect(X(group.x), Y(group.y + group.height), S(group.width), S(group.height), `data-group="assembly" data-group-x-mm="${group.x}" data-group-y-mm="${group.y}" fill="none" stroke="${overflow ? '#a62439' : '#67528b'}" stroke-width="2.4" stroke-dasharray="7 4"`));
  } else {
    parts.push(text(X(wall.width_mm / 2), Y(wall.height_mm / 2), 'No cabinets installed', 16, `text-anchor="middle" fill="${MUTED}"`));
  }
  parts.push(rect(X(0), Y(wall.height_mm), S(wall.width_mm), S(wall.height_mm), 'data-wall="target" fill="none" stroke="#182b3a" stroke-width="4"'));

  // Brackets connect the actual wall and complete-group edge coordinates. A
  // zero span still has visible ticks and a leader to its explicit 0 mm label.
  const overlapTop = Math.max(Y(wall.height_mm), Y(group.y + group.height));
  const overlapBottom = Math.min(Y(0), Y(group.y));
  const rowY = (overlapTop + overlapBottom) / 2;
  const overlapLeft = Math.max(X(0), X(group.x)), overlapRight = Math.min(X(wall.width_mm), X(group.x + group.width));
  const topX = overlapLeft + (overlapRight - overlapLeft) * 0.36;
  const bottomX = overlapLeft + (overlapRight - overlapLeft) * 0.64;
  labels.left.x = 10; labels.left.y = plot.y + 22;
  labels.right.x = W - labels.right.width - 10; labels.right.y = plot.y + plot.h - labels.right.height - 22;
  labels.top.x = 350; labels.top.y = 118 + headerExtra;
  labels.bottom.x = 470; labels.bottom.y = plot.y + plot.h + 30;
  const segments = {
    left: [X(0),rowY,X(group.x),rowY], right: [X(group.x + group.width),rowY,X(wall.width_mm),rowY],
    top: [topX,Y(wall.height_mm),topX,Y(group.y + group.height)], bottom: [bottomX,Y(group.y),bottomX,Y(0)],
  };
  for (const edge of ['left','right','top','bottom']) {
    const label = labels[edge], [x1,y1,x2,y2] = segments[edge];
    const color = label.value < 0 ? '#a62439' : '#315f69';
    const midX = (x1+x2)/2, midY = (y1+y2)/2;
    parts.push(line(x1,y1,x2,y2,`stroke="#fff" stroke-width="6"`));
    parts.push(line(x1,y1,x2,y2,`data-gap-edge="${edge}" data-gap-mm="${label.value}" stroke="${color}" stroke-width="2"`));
    for (const [x,y] of [[x1,y1],[x2,y2]]) {
      parts.push(edge === 'left' || edge === 'right' ? line(x,y-8,x,y+8,`stroke="${color}" stroke-width="2"`) : line(x-8,y,x+8,y,`stroke="${color}" stroke-width="2"`));
    }
    const boxCX = label.x + label.width/2, boxCY = label.y + label.height/2;
    const endX = edge === 'left' ? label.x+label.width : edge === 'right' ? label.x : boxCX;
    const endY = edge === 'top' ? label.y+label.height : edge === 'bottom' ? label.y : boxCY;
    parts.push(line(midX,midY,endX,endY,`data-gap-leader="${edge}" stroke="${color}" stroke-width="1.4" stroke-dasharray="3 3"`));
    parts.push(rect(label.x,label.y,label.width,label.height,`data-gap-box="${edge}" rx="8" fill="#fff" stroke="${color}" stroke-width="1.2"`));
    let numberY = label.y + 73;
    const spans = [`<tspan x="${boxCX}" y="${label.y+29}" font-size="25">${edge.toUpperCase()} </tspan>`,`<tspan x="${boxCX}" y="${label.y+54}" font-size="22">${label.value < 0 ? 'overflow' : 'gap'} </tspan>`];
    label.numberLines.forEach(number => { numberY += label.numberSize; spans.push(`<tspan x="${boxCX}" y="${numberY}" font-size="${label.numberSize}">${esc(number)}</tspan>`); numberY += 7; });
    parts.push(`<text data-gap-label="${edge}" text-anchor="middle" font-weight="700" fill="${color}">${spans.join('')}</text>`);
  }

  let y = Math.max(plot.y+plot.h+24, labels.bottom.y+labels.bottom.height+30);
  y += paragraph(34,y,`LED GROUP · Width ${f(group.width)} mm · Height ${f(group.height)} mm · ${f(result.totalCount,0)} cabinets`,24,'font-weight="700"',32);
  y += paragraph(34,y,`Assembly alignment: ${alignmentName(group)} · ${compositionLine(result)}`,16,'font-weight="700"',24);
  y += paragraph(34,y,'Solid dark outline = WALL · Dashed outline = complete LED group · A + B move together',15,`fill="${MUTED}"`,22);
  zones.forEach((z,i) => { y += paragraph(34,y,`${String.fromCharCode(65+i)} · ${f(z.nx,0)} columns × ${f(z.ny,0)} rows · ${f(z.actualWidth)} × ${f(z.actualHeight)} mm`,16,`fill="${colors.get(z.panel.id).line}"`,24); });
  if (reducedDetail) y += paragraph(34,y,'Dense grid: illustrative detail; cabinet counts are unchanged.',13,`fill="${MUTED}"`,20);
  if (report) {
    y += 22;
    parts.push(line(34,y-12,W-34,y-12,'stroke="#d4dde5"'));
    y += paragraph(34,y,splitDescription(result),14,'font-weight="700"')+3;
    y += paragraph(34,y,packingDescription(result),13,`fill="${MUTED}"`)+7;
    y += paragraph(34,y,`Wall edge gaps: ${gapLine(group)}${group.hasCabinets ? '' : ' (no cabinets installed)'}`,14,'font-weight="700"')+10;
    zones.forEach((z,i) => {
      const active = activeExtents(z), c = colors.get(z.panel.id);
      parts.push(rect(34,y-12,15,15,`rx="2" fill="${c.fill}" stroke="${c.line}" stroke-width="1.5"`));
      y += paragraph(60,y,`${String.fromCharCode(65+i)} · ${z.label} — ${z.panel.name} · ${orientation(z)}`,15,'font-weight="700"',22);
      y += paragraph(60,y,`${f(z.nx,0)} × ${f(z.ny,0)} = ${f(z.count,0)} cabinets · ${f(z.resolutionW,0)} × ${f(z.resolutionH,0)} px · Footprint ${f(z.actualWidth)} × ${f(z.actualHeight)} mm`,13);
      y += paragraph(60,y,`Packed frame origin (${f(z.actualX)}, ${f(z.actualY)}) mm from wall bottom-left`,12,`fill="${MUTED}"`);
      if (result.sizingMode !== 'manual') y += paragraph(60,y,`Sizing allocation ${f(z.width)} × ${f(z.height)} mm · Frame area / allocation ${f(z.utilization*100)}%`,12,`fill="${MUTED}"`);
      y += paragraph(60,y,`Frame ${f(z.panel.frame_width_mm)} × ${f(z.panel.frame_height_mm)} mm · Active ${f(z.panel.active_width_mm)} × ${f(z.panel.active_height_mm)} mm`,12,`fill="${MUTED}"`);
      y += paragraph(60,y,`LED active extent aspect ${ratio(active.width,active.height)} · LED pixel aspect ${ratio(z.resolutionW,z.resolutionH)}`,12,`fill="${MUTED}"`);
      y += paragraph(60,y,`Zone power: ${powerLine(z.power)}`,12,`fill="${MUTED}"`)+12;
    });
    y += paragraph(34,y,`Whole wall power: ${powerLine(result.power)}`,13,'font-weight="700"')+8;
    const canvasLine = result.canvas?.combined ? `Combined canvas ${f(result.canvas.width,0)} × ${f(result.canvas.height,0)} px. ${result.canvas.reason || ''}` : `Processor mapping / separate canvases: ${result.canvas?.reason || 'Use per-zone resolutions.'}`;
    y += paragraph(34,y,canvasLine,14,'font-weight="700"',22)+8;
    y += paragraph(34,y,`Target aspect ${ratio(wall.width_mm,wall.height_mm)} · Installed frame area / wall ${f(result.utilization*100)}%`,13,`fill="${MUTED}"`)+8;
    y += paragraph(34,y,`Counts by SKU: ${(result.counts || []).map(c => `${c.name} × ${f(c.count,0)}`).join(' | ')}`,13,'',21)+8;
    for (const c of result.counts || []) y += paragraph(34,y,`SKU power · ${c.name} (${f(c.count,0)} cabinets): ${powerLine(c.power)}`,13)+8;
    const warnings = allWarnings(result);
    y += paragraph(34,y,warnings.length ? 'LAYOUT WARNINGS' : 'No layout warnings.',12,'font-weight="700"')+5;
    for (const warning of warnings) y += paragraph(34,y,`${warning.level === 'red' ? 'OVERFLOW / CHECK' : 'CHECK'}: ${warning.message}`,13,`fill="${warning.level === 'red' ? '#a62439' : '#895700'}"`)+8;
    y += paragraph(34,y,'Active extent spans the outer lit edges, including gaps between cabinets.',11,`fill="${MUTED}"`)+5;
    y += paragraph(34,y,'Power totals multiply supplied per-panel wattage by installed cabinet count; missing ratings remain unknown or partial. Confirm product dimensions, ratings and processor mapping before installation.',11,`fill="${MUTED}"`)+20;
  }
  const height = Math.ceil(y+14), width = report ? 1800 : W, pixelHeight = Math.round(height*width/W);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="layout-svg" role="img" aria-label="LED wall layout diagram" width="${width}" height="${pixelHeight}" viewBox="0 0 ${W} ${height}"><title>${esc(wall.name || 'LED wall layout')}</title><desc>${esc(splitDescription(result))}. ${esc(f(result.totalCount,0))} cabinets. ${esc(compositionLine(result))}. Assembly alignment ${esc(alignmentName(group))}. Wall edge gaps: ${esc(gapLine(group))}. All dimensions in millimeters.</desc><defs>${defs.join('')}</defs><rect width="${W}" height="${height}" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif" fill="${INK}">${parts.join('')}</g></svg>`;
}

export async function downloadPNG(result) {
  const svg = renderDiagram(result, { report: true });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not render the layout image. Try again in a current browser.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is unavailable: this browser could not create a canvas.');
    context.drawImage(image, 0, 0);
    const png = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG export failed. Try a smaller report or reload the page.')), 'image/png'));
    const output = URL.createObjectURL(png);
    const anchor = document.createElement('a');
    anchor.href = output;
    anchor.download = `${(result.wall.name || 'led-wall-layout').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 70)}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(output), 60_000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
