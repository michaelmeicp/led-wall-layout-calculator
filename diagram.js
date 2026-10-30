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
  if (result.mode !== 'two_zones') return 'Single panel type';
  return result.split.direction === 'vertical'
    ? `Vertical sizing split · ${f(result.split.offset_mm)} mm from LEFT · A / B sizing allocations`
    : `Horizontal sizing split · ${f(result.split.offset_mm)} mm from BOTTOM · A / B sizing allocations`;
}

function packingDescription(result) {
  if (result.mode !== 'two_zones') return 'Single cabinet block';
  return result.split.direction === 'vertical'
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
    `Mode: ${result.mode === 'two_zones' ? 'Two zones' : 'Single zone'}; strategy: ${strategyName(result.strategy)}`,
    splitDescription(result),
    packingDescription(result),
    'Alignment moves the complete assembly together; +X right, +Y up. Gaps measure full-wall edges to the assembly bounding box; negative clearance is overflow. Active areas are centered in frames.',
    `Assembly alignment: ${alignmentName(group)}; group origin (${f(group.x)}, ${f(group.y)}) mm from wall bottom-left`,
    `Assembly frame bounds: ${f(group.width)} × ${f(group.height)} mm`,
    `Wall edge gaps: ${gapLine(group)}${group.hasCabinets ? '' : ' (no cabinets installed)'}`,
    result.mode === 'two_zones' ? 'The sizing split determines cabinet counts; it is not a fixed physical seam or assembly anchor.' : '',
    '',
  ];
  result.zones.forEach((z, i) => {
    const active = activeExtents(z);
    lines.push(
      `${String.fromCharCode(65 + i)} · ${z.label}`,
      `Model: ${z.panel.name}; orientation: ${z.rotated ? '90° clockwise' : '0° / native'}`,
      `Sizing allocation: ${f(z.width)} × ${f(z.height)} mm`,
      `Packed frame origin: (${f(z.actualX)}, ${f(z.actualY)}) mm from wall bottom-left`,
      `Cabinet: frame ${f(z.panel.frame_width_mm)} × ${f(z.panel.frame_height_mm)} mm; active ${f(z.panel.active_width_mm)} × ${f(z.panel.active_height_mm)} mm; ${f(z.panel.resolution_w, 0)} × ${f(z.panel.resolution_h, 0)} px`,
      `Grid: ${f(z.nx, 0)} × ${f(z.ny, 0)} = ${f(z.count, 0)} cabinets`,
      `Per-zone resolution: ${f(z.resolutionW, 0)} × ${f(z.resolutionH, 0)} px`,
      `Actual frame footprint: ${f(z.actualWidth)} × ${f(z.actualHeight)} mm`,
      `Zone power: ${powerLine(z.power)}`,
      `Frame area / sizing allocation: ${f(z.utilization * 100)}%; active extent aspect: ${ratio(active.width, active.height)}; pixel aspect: ${ratio(z.resolutionW, z.resolutionH)}`,
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
  const W = 1200;
  const wall = result.wall;
  const zones = result.zones;
  const group = result.group;
  const colors = colorsFor(result);
  const titleLines = report ? wrap(wall.name || 'Untitled wall', W - 68, 26, true)
    : [shorten(wall.name || 'Untitled wall', W - 68, 26, true)];
  const titleExtra = (titleLines.length - 1) * 29;
  const subtitleLines = wrap(`Target ${f(wall.width_mm)} × ${f(wall.height_mm)} mm   ·   ${strategyName(result.strategy)}   ·   ${f(result.totalCount, 0)} cabinets`, W - 68, 15);
  const headerExtra = titleExtra + (subtitleLines.length - 1) * 22;
  const maxX = Math.max(wall.width_mm, ...zones.map((z) => z.actualX + z.actualWidth));
  const maxY = Math.max(wall.height_mm, ...zones.map((z) => z.actualY + z.actualHeight));
  const minX = Math.min(0, ...zones.map((z) => z.actualX));
  const minY = Math.min(0, ...zones.map((z) => z.actualY));
  const plot = { x: 94, y: 134 + headerExtra, w: 1014, h: 454 };
  const scale = Math.min(plot.w / (maxX - minX || 1), plot.h / (maxY - minY || 1));
  const ox = plot.x + (plot.w - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = plot.y + (plot.h + (maxY - minY) * scale) / 2 + minY * scale;
  const X = (x) => rounded(ox + x * scale);
  const Y = (y) => rounded(oy - y * scale);
  const S = (n) => rounded(n * scale);
  const text = (x, y, value, size = 14, extra = '') => `<text x="${rounded(x)}" y="${rounded(y)}" font-size="${size}" ${extra}>${esc(value)}</text>`;
  const rect = (x, y, w, h, extra = '') => `<rect x="${rounded(x)}" y="${rounded(y)}" width="${rounded(Math.max(0, w))}" height="${rounded(Math.max(0, h))}" ${extra}/>`;
  const line = (x1, y1, x2, y2, extra = '') => `<line x1="${rounded(x1)}" y1="${rounded(y1)}" x2="${rounded(x2)}" y2="${rounded(y2)}" ${extra}/>`;
  const parts = [];
  const defs = [];
  const paragraph = (x, y, value, size = 14, extra = '', lineHeight = Math.ceil(size * 1.5)) => {
    const lines = wrap(value, W - x - 34, size, extra.includes('font-weight="700"'));
    lines.forEach((value, i) => parts.push(text(x, y + i * lineHeight, value, size, extra)));
    return lines.length * lineHeight;
  };
  let reducedDetail = false;
  parts.push(text(34, 32, 'LED WALL  /  PANEL LAYOUT', 14, 'font-weight="700" letter-spacing="1.8" fill="#276b68"'));
  titleLines.forEach((label, i) => parts.push(text(34, 65 + i * 29, label, 26, 'font-weight="700"')));
  subtitleLines.forEach((label, i) => parts.push(text(34, 92 + titleExtra + i * 22, label, 15, `fill="${MUTED}"`)));
  parts.push(text(W - 34, 32, date.toISOString().slice(0, 10) + ' UTC', 12, `text-anchor="end" fill="${MUTED}"`));

  // A white target base keeps frame/active gaps obvious even on a colored UI.
  parts.push(rect(X(0), Y(wall.height_mm), S(wall.width_mm), S(wall.height_mm), 'fill="#f8fafc"'));
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
            if (fw >= 80 && fh >= 52 && z.count <= 180) {
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
  // The bounding rectangle belongs to the complete packed assembly; stepped
  // blocks need not occupy every point inside these bounds.
  if (group.hasCabinets) {
    const overflow = Object.values(group.gaps).some((value) => value < 0);
    parts.push(rect(X(group.x), Y(group.y + group.height), S(group.width), S(group.height), `data-group="assembly" data-group-x-mm="${group.x}" data-group-y-mm="${group.y}" fill="none" stroke="${overflow ? '#a62439' : '#67528b'}" stroke-width="1.7" stroke-dasharray="6 3"`));
  } else {
    parts.push(text(X(wall.width_mm / 2), Y(wall.height_mm / 2), 'No cabinets installed', 16, `text-anchor="middle" fill="${MUTED}"`));
  }
  // The full wall is the only fixed placement boundary. Sizing split information
  // stays in the text so it cannot be mistaken for the physical cabinet seam.
  parts.push(rect(X(0), Y(wall.height_mm), S(wall.width_mm), S(wall.height_mm), 'fill="none" stroke="#182b3a" stroke-width="2.6"'));
  // Dimension brackets are tied to the target, not to an overflowing footprint.
  const dimY = plot.y + plot.h + 27;
  parts.push(line(X(0), dimY, X(wall.width_mm), dimY, 'stroke="#4c6070" stroke-width="1"'));
  parts.push(line(X(0), dimY - 6, X(0), dimY + 6, 'stroke="#4c6070"'));
  parts.push(line(X(wall.width_mm), dimY - 6, X(wall.width_mm), dimY + 6, 'stroke="#4c6070"'));
  parts.push(text((X(0) + X(wall.width_mm)) / 2, dimY + 21, `${f(wall.width_mm)} mm target`, 13, `text-anchor="middle" fill="${MUTED}"`));
  const dimX = plot.x - 23;
  parts.push(line(dimX, Y(0), dimX, Y(wall.height_mm), 'stroke="#4c6070" stroke-width="1"'));
  parts.push(line(dimX - 6, Y(0), dimX + 6, Y(0), 'stroke="#4c6070"'));
  parts.push(line(dimX - 6, Y(wall.height_mm), dimX + 6, Y(wall.height_mm), 'stroke="#4c6070"'));
  const midY = (Y(0) + Y(wall.height_mm)) / 2;
  parts.push(`<text x="${dimX - 13}" y="${midY}" transform="rotate(-90 ${dimX - 13} ${midY})" font-size="13" fill="${MUTED}" text-anchor="middle">${esc(f(wall.height_mm))} mm target</text>`);

  let y = 666 + headerExtra;
  y += paragraph(34, y, splitDescription(result), 14, 'font-weight="700"') + 3;
  y += paragraph(34, y, packingDescription(result), 12, `fill="${MUTED}"`) + 5;
  y += paragraph(34, y, `Assembly alignment: ${alignmentName(group)} · Frame bounds ${f(group.width)} × ${f(group.height)} mm · Origin (${f(group.x)}, ${f(group.y)}) mm`, 14, 'font-weight="700"');
  y += paragraph(34, y, `Wall edge gaps: ${gapLine(group)}${group.hasCabinets ? '' : ' (no cabinets installed)'}`, 14, 'font-weight="700"');
  y += paragraph(34, y, 'Dark outline = full wall · Dashed outline = complete assembly bounds (red for overflow) · Gaps measure wall to assembly bounds.', 12, `fill="${MUTED}"`) + 5;
  if (result.mode === 'two_zones') y += paragraph(34, y, 'Sizing split determines counts only; the physical seam moves with the assembly. Empty blocks reserve no space.', 12, `fill="${MUTED}"`);
  y += paragraph(34, y, `Cabinet edges show physical frames; inset fill shows centered active area. Scale: ${f(100 / scale)} mm per 100 drawing units.`, 12, `fill="${MUTED}"`);
  if (reducedDetail) {
    y += 7;
    y += paragraph(34, y, 'Dense grid: labels/detail reduced (maximum 1,200 individual cabinets). Coarse lines may be illustrative; counts are unchanged.', 12, `fill="${MUTED}"`);
  }
  y += 16;
  zones.forEach((z, i) => {
    const active = activeExtents(z);
    const c = colors.get(z.panel.id);
    parts.push(rect(34, y - 12, 15, 15, `rx="2" fill="${c.fill}" stroke="${c.line}" stroke-width="1.5"`));
    y += paragraph(60, y, `${String.fromCharCode(65 + i)} · ${z.label} — ${z.panel.name} · ${orientation(z)}`, 15, 'font-weight="700"', 22);
    y += paragraph(60, y, `${f(z.nx, 0)} × ${f(z.ny, 0)} = ${f(z.count, 0)} cabinets   |   ${f(z.resolutionW, 0)} × ${f(z.resolutionH, 0)} px   |   Footprint ${f(z.actualWidth)} × ${f(z.actualHeight)} mm`, 13);
    y += paragraph(60, y, `Packed frame origin (${f(z.actualX)}, ${f(z.actualY)}) mm from wall bottom-left`, 12, `fill="${MUTED}"`);
    y += paragraph(60, y, `Zone power: ${powerLine(z.power)}`, 12, `fill="${MUTED}"`);
    y += paragraph(60, y, `Sizing allocation ${f(z.width)} × ${f(z.height)} mm · Frame area / allocation ${f(z.utilization * 100)}%`, 12, `fill="${MUTED}"`);
    y += paragraph(60, y, `Frame ${f(z.panel.frame_width_mm)} × ${f(z.panel.frame_height_mm)} mm   ·   Active ${f(z.panel.active_width_mm)} × ${f(z.panel.active_height_mm)} mm`, 12, `fill="${MUTED}"`);
    y += paragraph(60, y, `LED active extent aspect ${ratio(active.width, active.height)}   ·   LED pixel aspect ${ratio(z.resolutionW, z.resolutionH)}`, 12, `fill="${MUTED}"`) + 12;
  });
  y += paragraph(34, y, `Whole wall power: ${powerLine(result.power)}`, 13, 'font-weight="700"') + 12;
  if (report) {
    parts.push(line(34, y - 9, W - 34, y - 9, 'stroke="#d4dde5"'));
    const canvasLine = result.canvas?.combined
      ? `Combined canvas ${f(result.canvas.width, 0)} × ${f(result.canvas.height, 0)} px. ${result.canvas.reason || ''}`
      : `Processor mapping / separate canvases: ${result.canvas?.reason || 'Use per-zone resolutions.'}`;
    y += paragraph(34, y + 12, canvasLine, 14, 'font-weight="700"', 22);
    y += 8;
    y += paragraph(34, y + 12, `Target aspect ${ratio(wall.width_mm, wall.height_mm)} · Installed frame area / wall ${f(result.utilization * 100)}%`, 13, `fill="${MUTED}"`) + 10;
    y += paragraph(34, y + 12, `Counts by SKU: ${(result.counts || []).map((c) => `${c.name} × ${f(c.count, 0)}`).join('   |   ')}`, 13, '', 21);
    y += 14;
    for (const c of result.counts || []) {
      y += paragraph(34, y, `SKU power · ${c.name} (${f(c.count, 0)} cabinets): ${powerLine(c.power)}`, 13) + 5;
    }
    y += 10;
    const warnings = allWarnings(result);
    if (!warnings.length) {
      parts.push(text(34, y, 'No layout warnings.', 13, `fill="${MUTED}"`));
      y += 25;
    } else {
      parts.push(text(34, y, 'LAYOUT WARNINGS', 12, 'font-weight="700" letter-spacing="1"'));
      y += 25;
      warnings.forEach((warning) => {
        const warningColor = warning.level === 'red' ? '#a62439' : '#895700';
        const lines = wrap(`${warning.level === 'red' ? 'OVERFLOW / CHECK' : 'CHECK'}: ${warning.message}`, W - 46 - 34, 13);
        parts.push(rect(34, y - 11, 4, lines.length * 19 + 4, `fill="${warningColor}" rx="2"`));
        for (const wline of lines) {
          parts.push(text(46, y, wline, 13, `fill="${warningColor}"`));
          y += 19;
        }
        y += 12;
      });
    }
    y += paragraph(34, y + 12, 'Active extent spans the outer lit edges, including gaps between cabinets.', 11, `fill="${MUTED}"`);
    y += paragraph(34, y + 12, 'Power totals multiply supplied per-panel wattage by installed cabinet count; missing ratings remain unknown or partial. Confirm product dimensions, ratings and processor mapping before installation.', 11, `fill="${MUTED}"`) + 20;
  }
  const height = Math.ceil(y + 14);
  const width = report ? 1800 : 1200;
  const pixelHeight = Math.round(height * width / W);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="layout-svg" role="img" aria-label="LED wall layout diagram" width="${width}" height="${pixelHeight}" viewBox="0 0 ${W} ${height}"><title>${esc(wall.name || 'LED wall layout')}</title><desc>${esc(splitDescription(result))}. ${esc(f(result.totalCount, 0))} cabinets. Assembly alignment ${esc(alignmentName(group))}. Wall edge gaps: ${esc(gapLine(group))}. All dimensions in millimeters.</desc><defs>${defs.join('')}</defs><rect width="${W}" height="${height}" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif" fill="${INK}">${parts.join('')}</g></svg>`;
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
