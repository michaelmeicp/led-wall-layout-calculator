/** Pure geometry and validation; millimetres are physical, resolution is pixels. */
export const EXACT_TOLERANCE_MM = 0.5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isEmpty = value => value === undefined || value === null || value === '';
const MAX_NOISE_MM = 1e-9;
const precision = (...values) => Math.min(MAX_NOISE_MM, Number.EPSILON * 16 * Math.max(1, ...values.map(Math.abs)));
const same = (a, b) => Math.abs(a - b) <= Math.min(MAX_NOISE_MM, Number.EPSILON * 16 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE));
const warn = (level, message) => ({ level, message });

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function positive(value, label, integer = false) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${label} must be a positive ${integer ? 'integer' : 'number'}.`);
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${label} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`${label} must be a positive ${integer ? 'safe integer' : 'finite number'}.`);
  }
  return number;
}

function finite(value, label) {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} exceeds the supported numerical range. Use smaller dimensions or fewer cabinets.`);
  }
  return value;
}

function dimension(value, label) {
  const number = finite(positive(value, label), label);
  // SVG report scaling divides a few thousand CSS pixels by a physical span.
  // Reject subnormal spans that cannot support that operation before rendering.
  if (!Number.isFinite(10000 / number)) throw new Error(`${label} is too small for the supported numerical range.`);
  return number;
}

function text(value, label, required = false, maxLength = 160) {
  if (isEmpty(value)) {
    if (required) throw new Error(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw new Error(`${label} is required.`);
  if (clean.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return clean;
}

/** Missing frame axes default independently to their active axes. Missing pixel
 * axes derive independently from active / pitch, rounded to nearest integer
 * (positive .5 rounds up). Explicit resolutions always win. */
export function normalizePanel(raw) {
  object(raw, 'Panel');
  const id = isEmpty(raw.id) ? globalThis.crypto.randomUUID() : raw.id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Panel id must be a UUID.');
  const panel = {
    id: id.toLowerCase(),
    name: text(raw.name, 'Panel name', true),
    vendor: text(raw.vendor, 'Vendor'),
    notes: text(raw.notes, 'Notes', false, 2000),
    active_width_mm: dimension(raw.active_width_mm, 'Active width'),
    active_height_mm: dimension(raw.active_height_mm, 'Active height'),
  };
  panel.frame_width_mm = isEmpty(raw.frame_width_mm) ? panel.active_width_mm : dimension(raw.frame_width_mm, 'Frame width');
  panel.frame_height_mm = isEmpty(raw.frame_height_mm) ? panel.active_height_mm : dimension(raw.frame_height_mm, 'Frame height');
  if (panel.frame_width_mm < panel.active_width_mm || panel.frame_height_mm < panel.active_height_mm) {
    throw new Error('Frame width and height must each be at least the corresponding active dimension; the frame cannot conceal the active area.');
  }
  if (raw.rotatable !== undefined && typeof raw.rotatable !== 'boolean') throw new Error('Rotatable must be true or false.');
  panel.rotatable = raw.rotatable ?? false;
  panel.pixel_pitch_mm = isEmpty(raw.pixel_pitch_mm) ? null : positive(raw.pixel_pitch_mm, 'Pixel pitch');
  panel.warnings = [];
  for (const [axis, dimension, title] of [['w', 'active_width_mm', 'width'], ['h', 'active_height_mm', 'height']]) {
    const key = `resolution_${axis}`;
    const derived = isEmpty(raw[key]);
    panel[`derived_resolution_${axis}`] = derived;
    if (derived && panel.pixel_pitch_mm === null) throw new Error(`Resolution ${title} is required unless pixel pitch is provided.`);
    panel[key] = derived
      ? positive(Math.round(panel[dimension] / panel.pixel_pitch_mm), `Derived resolution ${title}`, true)
      : positive(raw[key], `Resolution ${title}`, true);
    const actualPitch = panel[dimension] / panel[key];
    if (!Number.isFinite(actualPitch) || actualPitch <= 0) throw new Error(`Derived ${title} pixel pitch is outside the supported numerical range.`);
    panel[`actual_pitch_${axis === 'w' ? 'x' : 'y'}_mm`] = actualPitch;
    if (panel.pixel_pitch_mm !== null && Math.abs(actualPitch - panel.pixel_pitch_mm) / panel.pixel_pitch_mm > 0.01 + Number.EPSILON * 16) {
      panel.warnings.push(warn('amber', `${panel.name}: ${derived ? 'rounded' : 'explicit'} ${title} resolution implies ${format(actualPitch)} mm pitch, more than 1% different from the supplied ${format(panel.pixel_pitch_mm)} mm.`));
    }
  }
  return panel;
}

/** Imports validate the entire library before returning anything to the UI. */
export function parseLibrary(input) {
  let data;
  try { data = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new Error('Import is not valid JSON.'); }
  if (!Array.isArray(data)) {
    object(data, 'Library');
    if (data.version !== 1) throw new Error('Unsupported library version; expected version 1.');
    data = data.panels;
  }
  if (!Array.isArray(data)) throw new Error('Library must contain a panels array.');
  const ids = new Set();
  return data.map((raw, index) => {
    try {
      object(raw, 'Panel');
      if (isEmpty(raw.id)) throw new Error('Imported panels must have a UUID id.');
      const panel = normalizePanel(raw);
      if (ids.has(panel.id.toLowerCase())) throw new Error('Duplicate panel UUID.');
      ids.add(panel.id.toLowerCase());
      return panel;
    } catch (error) {
      throw new Error(`Panel ${index + 1}: ${error.message}`);
    }
  });
}

/** Rotation always swaps frame, active area, resolution, and actual pitch. */
export function orientPanel(raw, rotated = false) {
  if (typeof rotated !== 'boolean') throw new Error('Rotation must be true or false.');
  const panel = normalizePanel(raw);
  if (rotated && !panel.rotatable) throw new Error(`${panel.name} does not allow rotation.`);
  if (rotated) {
    for (const [a, b] of [
      ['frame_width_mm', 'frame_height_mm'], ['active_width_mm', 'active_height_mm'],
      ['resolution_w', 'resolution_h'], ['actual_pitch_x_mm', 'actual_pitch_y_mm'],
      ['derived_resolution_w', 'derived_resolution_h'],
    ]) [panel[a], panel[b]] = [panel[b], panel[a]];
  }
  return { ...panel, rotated };
}

/** Only correct arithmetic noise when a quotient is within 16 machine epsilons
 * of an integer, capped at 1e-9 in the quotient AND physical millimetres.
 * This is NOT the exact-only 0.5 mm allowance. */
function quotient(dimension, frame) {
  const ratio = dimension / frame;
  if (!Number.isFinite(ratio)) throw new Error('Cabinet count exceeds the supported numerical range.');
  const nearest = Math.round(ratio);
  // Positive dimensions can never produce an exact zero quotient. Preserve a
  // tiny positive ratio so cover-wall still returns one cabinet, not zero.
  return nearest > 0
    && Math.abs(ratio - nearest) <= precision(ratio)
    && Math.abs(dimension - nearest * frame) <= MAX_NOISE_MM
    ? nearest : ratio;
}

function axisCount(dimension, frame, strategy, label) {
  const ratio = quotient(dimension, frame);
  const lower = Math.floor(ratio), upper = Math.ceil(ratio);
  const nearest = Math.round(ratio);
  if (strategy === 'exact_only') {
    // Comparing physical residuals keeps the tolerance independent of panel size.
    if (nearest < 1 || Math.abs(dimension - nearest * frame) > EXACT_TOLERANCE_MM) {
      throw new Error(`${label} has no exact integer fit within ±0.5 mm. Fit inside: ${lower} (${format(lower * frame)} mm); cover wall: ${upper} (${format(upper * frame)} mm).`);
    }
    if (!Number.isSafeInteger(nearest)) throw new Error('Cabinet count exceeds the supported numerical range.');
    return nearest;
  }
  const count = strategy === 'cover_wall' ? upper : lower;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Cabinet count exceeds the supported numerical range.');
  return count;
}

function format(value) {
  return Number(value.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function makeZone(rectangle, choice, library, strategy) {
  object(choice, `${rectangle.label} selection`);
  const panelId = typeof choice.panelId === 'string' ? choice.panelId.toLowerCase() : choice.panelId;
  const raw = library.find(panel => panel.id === panelId);
  if (!raw) throw new Error(`Choose a library panel for ${rectangle.label}.`);
  const panel = orientPanel(raw, choice.rotated ?? false);
  const nx = axisCount(rectangle.width, panel.frame_width_mm, strategy, `${rectangle.label} width`);
  const ny = axisCount(rectangle.height, panel.frame_height_mm, strategy, `${rectangle.label} height`);
  const count = finite(nx * ny, 'Cabinet count');
  // An empty axis means no complete cabinets, no footprint, and no pixel canvas.
  const actualWidth = count ? finite(nx * panel.frame_width_mm, 'Actual width') : 0;
  const actualHeight = count ? finite(ny * panel.frame_height_mm, 'Actual height') : 0;
  const activeWidth = count ? finite(nx * panel.active_width_mm, 'Active width') : 0;
  const activeHeight = count ? finite(ny * panel.active_height_mm, 'Active height') : 0;
  const resolutionW = count ? finite(nx * panel.resolution_w, 'Pixel width') : 0;
  const resolutionH = count ? finite(ny * panel.resolution_h, 'Pixel height') : 0;
  const deltaW = rectangle.width - actualWidth, deltaH = rectangle.height - actualHeight;
  const utilization = finite((actualWidth / rectangle.width) * (actualHeight / rectangle.height), 'Area utilization');
  const warnings = panel.warnings.map(item => ({ ...item }));
  if (!count) warnings.push(warn('amber', `${rectangle.label} is too small for a complete cabinet (${nx} × ${ny}); no active canvas.`));
  if (deltaW < -precision(rectangle.width, actualWidth) || deltaH < -precision(rectangle.height, actualHeight)) {
    warnings.push(warn('red', `${rectangle.label} overflows its target: ${format(Math.max(0, -deltaW))} mm horizontally, ${format(Math.max(0, -deltaH))} mm vertically.`));
  }
  if (deltaW > precision(rectangle.width, actualWidth) || deltaH > precision(rectangle.height, actualHeight)) {
    warnings.push(warn('amber', `${rectangle.label} underfills its target: ${format(Math.max(0, deltaW))} mm horizontally, ${format(Math.max(0, deltaH))} mm vertically.`));
  }
  return { ...rectangle, panel, rotated: panel.rotated, nx, ny, count, actualWidth, actualHeight, activeWidth, activeHeight, resolutionW, resolutionH, deltaW, deltaH, utilization, warnings };
}

function canvasFor(zones, mode, split) {
  const no = reason => ({ combined: false, reason: `Processor mapping / two canvases: ${reason}` });
  if (zones.some(zone => !zone.count)) return { combined: false, reason: 'No combined canvas: at least one zone has no complete cabinets.' };
  if (mode === 'single') return { combined: true, width: zones[0].resolutionW, height: zones[0].resolutionH, reason: 'Single-zone pixel canvas.' };
  const [a, b] = zones;
  if (!same(a.panel.actual_pitch_x_mm, b.panel.actual_pitch_x_mm) || !same(a.panel.actual_pitch_y_mm, b.panel.actual_pitch_y_mm)) return no('actual derived pixel pitches differ.');
  if (zones.some(zone => !same(zone.panel.active_width_mm, zone.panel.frame_width_mm) || !same(zone.panel.active_height_mm, zone.panel.frame_height_mm))) return no('frame insets create incompatible active-area gaps.');
  if (zones.some(zone => zone.deltaW < -precision(zone.width, zone.actualWidth) || zone.deltaH < -precision(zone.height, zone.actualHeight))) return no('a zone crosses its boundary; clean abutment is not buildable.');
  if (split.direction === 'vertical') {
    if (!same(a.actualWidth, a.width) || !same(a.actualHeight, b.actualHeight) || a.resolutionH !== b.resolutionH) return no('left and right grids do not abut with matching aligned vertical pixel spans.');
    return { combined: true, width: finite(a.resolutionW + b.resolutionW, 'Combined pixel width'), height: a.resolutionH, reason: 'Clean vertical abutment; equal actual X/Y pitches and aligned pixel rows.' };
  }
  if (!same(a.actualHeight, a.height) || !same(a.actualWidth, b.actualWidth) || a.resolutionW !== b.resolutionW) return no('bottom and top grids do not abut with matching aligned horizontal pixel spans.');
  return { combined: true, width: a.resolutionW, height: finite(a.resolutionH + b.resolutionH, 'Combined pixel height'), reason: 'Clean horizontal abutment; equal actual X/Y pitches and aligned pixel columns.' };
}

/** Every zone anchors at its bottom-left. Horizontal offsets measure from bottom. */
export function calculate(config, panels) {
  object(config, 'Layout');
  object(config.wall, 'Wall');
  const wall = {
    name: text(config.wall.name, 'Wall name'),
    width_mm: dimension(config.wall.width_mm, 'Wall width'),
    height_mm: dimension(config.wall.height_mm, 'Wall height'),
  };
  // Bound products, not library size, so arithmetic remains finite and precise.
  finite(wall.width_mm, 'Wall width'); finite(wall.height_mm, 'Wall height');
  const mode = config.mode ?? 'single', strategy = config.strategy ?? 'fit_inside';
  if (!['single', 'two_zones'].includes(mode)) throw new Error('Choose single or two zones.');
  if (!['fit_inside', 'cover_wall', 'exact_only'].includes(strategy)) throw new Error('Choose a valid fit strategy.');
  if (!Array.isArray(panels)) throw new Error('Panel library must be an array.');
  const library = parseLibrary(panels);
  if (!Array.isArray(config.zones) || config.zones.length !== (mode === 'single' ? 1 : 2)) throw new Error(`Provide exactly ${mode === 'single' ? 'one zone' : 'two zones'}.`);
  let split = null;
  let rectangles = [{ label: 'Wall', x: 0, y: 0, width: wall.width_mm, height: wall.height_mm }];
  if (mode === 'two_zones') {
    object(config.split, 'Split');
    const direction = config.split.direction;
    if (!['vertical', 'horizontal'].includes(direction)) throw new Error('Choose a vertical or horizontal split.');
    const offset_mm = positive(config.split.offset_mm, 'Split offset');
    const span = direction === 'vertical' ? wall.width_mm : wall.height_mm;
    if (offset_mm >= span) throw new Error(`Split offset must lie strictly inside the wall (greater than 0 and less than ${format(span)} mm).`);
    split = { direction, offset_mm };
    rectangles = direction === 'vertical'
      ? [{ label: 'Left zone', x: 0, y: 0, width: offset_mm, height: wall.height_mm }, { label: 'Right zone', x: offset_mm, y: 0, width: wall.width_mm - offset_mm, height: wall.height_mm }]
      : [{ label: 'Bottom zone', x: 0, y: 0, width: wall.width_mm, height: offset_mm }, { label: 'Top zone', x: 0, y: offset_mm, width: wall.width_mm, height: wall.height_mm - offset_mm }];
  }
  const zones = rectangles.map((rectangle, index) => makeZone(rectangle, config.zones[index], library, strategy));
  const warnings = zones.flatMap(zone => zone.warnings);
  if (mode === 'two_zones') {
    const [a, b] = zones;
    if (!same(a.panel.actual_pitch_x_mm, b.panel.actual_pitch_x_mm) || !same(a.panel.actual_pitch_y_mm, b.panel.actual_pitch_y_mm)) {
      warnings.push(warn('amber', 'Mixed actual pixel pitches: per-zone resolutions require processor mapping.'));
    }
    const crossesCut = split.direction === 'vertical' ? a.actualWidth > a.width + precision(a.actualWidth, a.width) : a.actualHeight > a.height + precision(a.actualHeight, a.height);
    if (crossesCut && a.count) warnings.push(warn('red', `${a.label} crosses the split${b.count ? ' and overlaps the other zone' : ''}. This is not a clean buildable combined canvas.`));
  }
  const countMap = new Map();
  for (const zone of zones) {
    const key = zone.panel.id;
    if (!countMap.has(key)) countMap.set(key, { panelId: key, name: zone.panel.name, count: 0 });
    countMap.get(key).count = finite(countMap.get(key).count + zone.count, 'SKU count');
  }
  const totalCount = finite(zones.reduce((sum, zone) => sum + zone.count, 0), 'Total cabinet count');
  const utilization = finite(zones.reduce((sum, zone) => sum + zone.utilization * (zone.width / wall.width_mm) * (zone.height / wall.height_mm), 0), 'Total area utilization');
  return { wall, mode, strategy, split, zones, totalCount, counts: [...countMap.values()], warnings, canvas: canvasFor(zones, mode, split), utilization };
}
