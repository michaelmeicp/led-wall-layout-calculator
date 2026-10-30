/** Active emitting size / pixel conversions. Cabinet frames are never involved. */
export const CONVERSION_MODES = Object.freeze({
  size_to_pixels: 'Active size → pixels',
  pixels_to_size: 'Pixels → active size',
  infer_pitch: 'Active size + pixels → pitch',
});
export const PITCH_AXIS_TOLERANCE = 0.01;
const missing = value => value === undefined || value === null || value === '' || (typeof value === 'string' && !value.trim());

function positive(value, label, integer = false) {
  if (missing(value)) throw new Error(`${label} is required.${label === 'Pixel pitch (mm)' ? ' Size and pixels cannot be uniquely converted without pitch.' : ''}`);
  if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive finite ${integer ? 'whole-pixel count' : 'number'}.`);
  }
  const number = Number(value);
  if (integer && !Number.isSafeInteger(number)) throw new Error(`${label} must be a positive safe integer. Fractional pixels are theoretical, not an installed pixel count.`);
  return supported(number, label);
}

function supported(value, label) {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`${label} exceeds the supported numerical range.`);
  return value;
}

function derivedPositive(value, label) {
  supported(value, label);
  if (value <= 0) throw new Error(`${label} is too small for the supported numerical range.`);
  return value;
}

function drift(actual, target) {
  const value = supported(actual - target, 'Dimension drift');
  const noise = Math.min(1e-9, Number.EPSILON * 8 * Math.max(Math.abs(actual), Math.abs(target), Number.MIN_VALUE));
  return Math.abs(value) <= noise ? 0 : value;
}

// Decimal input values are compared as exact rational numbers for the
// half-up decision. Floating division alone turns 0.15 / 0.1 into a value
// just below 1.5; a blanket epsilon would also round genuine near-halves up.
function decimalFraction(value) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const fractionDigits = (mantissa.split('.')[1] || '').length;
  const coefficient = BigInt(mantissa.replace('.', ''));
  const scale = fractionDigits - Number(exponent);
  return scale >= 0
    ? { numerator: coefficient, denominator: 10n ** BigInt(scale) }
    : { numerator: coefficient * 10n ** BigInt(-scale), denominator: 1n };
}

function roundedPixelSuggestion(active, pitch) {
  const a = decimalFraction(active), p = decimalFraction(pitch);
  const numerator = a.numerator * p.denominator;
  const denominator = a.denominator * p.numerator;
  const whole = numerator / denominator;
  const rounded = whole + ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Rounded pixel count exceeds the supported numerical range.');
  return Number(rounded);
}

/** Forward results remain theoretical. Suggestions round independently with
 * positive halves rounded up. A rounded zero gets no whole-pixel suggestion.
 * Inverse/inferred modes require physical positive whole-pixel counts. */
export function calculateConversion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Conversion inputs must be an object.');
  const mode = raw.mode ?? 'size_to_pixels';
  if (typeof mode !== 'string' || !Object.hasOwn(CONVERSION_MODES, mode)) throw new Error('Choose a valid conversion mode.');
  let active, pixels, pitch_mm;
  if (mode !== 'pixels_to_size') active = { width_mm: positive(raw.width_mm, 'Active width (mm)'), height_mm: positive(raw.height_mm, 'Active height (mm)') };
  if (mode !== 'size_to_pixels') pixels = { width: positive(raw.pixels_w, 'Pixel width (px)', true), height: positive(raw.pixels_h, 'Pixel height (px)', true) };
  if (mode !== 'infer_pitch') pitch_mm = positive(raw.pitch_mm, 'Pixel pitch (mm)');
  if (mode === 'size_to_pixels') {
    pixels = { width: derivedPositive(active.width_mm / pitch_mm, 'Theoretical pixel width'), height: derivedPositive(active.height_mm / pitch_mm, 'Theoretical pixel height') };
    const width_px = roundedPixelSuggestion(active.width_mm, pitch_mm), height_px = roundedPixelSuggestion(active.height_mm, pitch_mm);
    let integerSuggestion = null;
    if (width_px >= 1 && height_px >= 1) {
      if (!Number.isSafeInteger(width_px) || !Number.isSafeInteger(height_px)) throw new Error('Rounded pixel count exceeds the supported numerical range.');
      const active_width_mm = derivedPositive(width_px * pitch_mm, 'Suggested active width');
      const active_height_mm = derivedPositive(height_px * pitch_mm, 'Suggested active height');
      integerSuggestion = { width_px, height_px, active_width_mm, active_height_mm, drift_width_mm: drift(active_width_mm, active.width_mm), drift_height_mm: drift(active_height_mm, active.height_mm) };
    }
    return { mode, active, pitch_mm, pixels, integerSuggestion };
  }
  if (mode === 'pixels_to_size') {
    active = { width_mm: derivedPositive(pixels.width * pitch_mm, 'Active width'), height_mm: derivedPositive(pixels.height * pitch_mm, 'Active height') };
    return { mode, active, pixels, pitch_mm };
  }
  const pitch = { x_mm: derivedPositive(active.width_mm / pixels.width, 'X pitch'), y_mm: derivedPositive(active.height_mm / pixels.height, 'Y pitch') };
  const relativeDifference = Math.abs(pitch.x_mm - pitch.y_mm) / Math.max(pitch.x_mm, pitch.y_mm);
  const consistent = relativeDifference <= PITCH_AXIS_TOLERANCE + Number.EPSILON * 8;
  return { mode, active, pixels, pitch, relativeDifference, consistent };
}
