import { calculateConversion } from './conversion.js';

const host = document.getElementById('conversion-worksheet');
if (host) {
  const STORAGE = 'led-pixel-converter-v1';
  const defaults = { version: 1, mode: 'size_to_pixels', width_mm: '2880', height_mm: '1620', pitch_mm: '1.5', pixels_w: '1920', pixels_h: '1080' };
  const fields = ['width_mm', 'height_mm', 'pitch_mm', 'pixels_w', 'pixels_h'];
  const ids = { width_mm: 'conversion-width-mm', height_mm: 'conversion-height-mm', pitch_mm: 'conversion-pitch-mm', pixels_w: 'conversion-pixels-w', pixels_h: 'conversion-pixels-h' };
  let state = { ...defaults }, storageWarning = '';
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) {
      const raw = JSON.parse(saved);
      if (!raw || typeof raw !== 'object' || raw.version !== 1 || !['size_to_pixels','pixels_to_size','infer_pitch'].includes(raw.mode)) throw new Error('Saved worksheet has an unsupported format.');
      state.mode = raw.mode;
      for (const key of fields) if (typeof raw[key] === 'string' || typeof raw[key] === 'number') state[key] = String(raw[key]);
    }
  } catch { storageWarning = 'Saved converter data could not be loaded. A P1.5 example is shown; your wall layout is unchanged.'; }
  host.innerHTML = `
    <div class="conversion-heading"><div><div class="eyebrow">SEPARATE WORKSHEET</div><h2>Active size ↔ pixels</h2><p>Convert the emitting LED area and pixel count using pixel pitch. Cabinet frame dimensions are excluded.</p></div></div>
    <div class="conversion-workspace">
      <section class="card conversion-inputs" aria-labelledby="conversion-input-title">
        <h3 id="conversion-input-title">What do you know?</h3>
        <label>Conversion mode<select id="conversion-mode"><option value="size_to_pixels">Active size + pitch → pixels</option><option value="pixels_to_size">Pixels + pitch → active size</option><option value="infer_pitch">Active size + pixels → pitch X / Y</option></select></label>
        <div id="conversion-size-fields"><div class="field-heading">Active emitting size <small>mm</small></div><div class="pair"><label>Active width (mm)<input id="conversion-width-mm" type="number" min="0" step="any" inputmode="decimal"></label><label>Active height (mm)<input id="conversion-height-mm" type="number" min="0" step="any" inputmode="decimal"></label></div></div>
        <div id="conversion-pixel-fields"><div class="field-heading">Physical pixel count <small>whole pixels</small></div><div class="pair"><label>Pixel width (px)<input id="conversion-pixels-w" type="number" min="1" step="1" inputmode="numeric"></label><label>Pixel height (px)<input id="conversion-pixels-h" type="number" min="1" step="1" inputmode="numeric"></label></div></div>
        <label id="conversion-pitch-field">Pixel pitch (mm)<input id="conversion-pitch-mm" type="number" min="0" step="any" inputmode="decimal" placeholder="Required to convert size ↔ pixels"></label>
        <p id="conversion-mode-help" class="helper"></p>
        <div class="conversion-examples"><span class="helper">Try an example</span><button id="conversion-example-p15" type="button" class="secondary">P1.5 · 1920 × 1080 px</button><button id="conversion-example-fractional" type="button" class="secondary">P1.5 · 3000 × 1700 mm</button></div>
        <p class="helper conversion-storage-note">This worksheet keeps its own values on this device. Switching tabs preserves both worksheets. It does not change your wall design or panel library.</p>
        <p id="conversion-storage-status" class="status-message" role="status"></p>
      </section>
      <section class="conversion-output" aria-live="polite" aria-atomic="true"><div id="conversion-error" class="error-box" role="alert" hidden></div><div id="conversion-results"></div></section>
    </div>`;
  const $ = id => document.getElementById(id);
  const f = n => new Intl.NumberFormat('en-US', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 12 }).format(n);
  const signed = n => n === 0 ? '0' : `${n > 0 ? '+' : '−'}${f(Math.abs(n))}`;
  const pair = (w,h,unit) => `${f(w)} × ${f(h)} ${unit}`;
  const row = (label, value) => `<div class="conversion-result-row"><span>${label}</span><strong>${value}</strong></div>`;
  const metric = (title, value, note, id = '') => `<div class="card conversion-metric"${id ? ` id="${id}"` : ''}><div class="eyebrow">${title}</div><div class="conversion-value">${value}</div><p class="helper">${note}</p></div>`;
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
    catch { storageWarning = 'Converter values are in memory only because device storage is unavailable. Your wall layout is unchanged.'; }
    $('conversion-storage-status').textContent = storageWarning;
  }
  function update() {
    $('conversion-size-fields').hidden = state.mode === 'pixels_to_size';
    $('conversion-pixel-fields').hidden = state.mode === 'size_to_pixels';
    $('conversion-pitch-field').hidden = state.mode === 'infer_pitch';
    $('conversion-mode-help').textContent = state.mode === 'infer_pitch'
      ? 'Each pitch is active dimension ÷ physical pixel count. X and Y are shown separately; a difference above 1% is flagged.'
      : 'Pitch is the distance between pixels in mm. Size alone or pixel count alone cannot determine the other without pitch.';
    try {
      const r = calculateConversion(state);
      $('conversion-error').hidden = true;
      $('conversion-results').hidden = false;
      if (r.mode === 'size_to_pixels') {
        let suggestion;
        if (r.integerSuggestion) {
          const s = r.integerSuggestion;
          suggestion = metric('Whole-pixel suggestion',pair(s.width_px,s.height_px,'px'),'Each axis is rounded to the nearest whole pixel; exact positive halves round up.','conversion-integer-suggestion') +
            `<div class="card conversion-detail"><h3>What that suggestion physically produces</h3>${row('Actual active size',pair(s.active_width_mm,s.active_height_mm,'mm'))}${row('Width drift',`${signed(s.drift_width_mm)} mm`)}${row('Height drift',`${signed(s.drift_height_mm)} mm`)}<p class="helper">Drift = suggested active size − requested active size. Positive is larger; negative is smaller.</p></div>`;
        } else suggestion = '<div class="warning" id="conversion-integer-suggestion">No viable whole-pixel suggestion: at least one axis rounds to 0 pixels. Increase that active dimension or use a smaller pitch. The theoretical calculation is shown above.</div>';
        $('conversion-results').innerHTML = metric('Mathematical result · theoretical',pair(r.pixels.width,r.pixels.height,'px'),'Active width / pitch × active height / pitch. A fractional value is a mathematical result, not a physically installed pixel count. Fractions are displayed to 12 significant digits.','conversion-theoretical-result') + suggestion;
      } else if (r.mode === 'pixels_to_size') {
        $('conversion-results').innerHTML = metric('Active emitting size',pair(r.active.width_mm,r.active.height_mm,'mm'),'Pixel width × pitch and pixel height × pitch.','conversion-active-result') +
          `<div class="card conversion-detail"><h3>Calculation</h3>${row('Width',`${f(r.pixels.width)} px × ${f(r.pitch_mm)} mm = ${f(r.active.width_mm)} mm`)}${row('Height',`${f(r.pixels.height)} px × ${f(r.pitch_mm)} mm = ${f(r.active.height_mm)} mm`)}<p class="helper">This measures the emitting image area. Cabinet frames and surrounding wall gaps require the Wall layout worksheet.</p></div>`;
      } else {
        const warning = r.consistent
          ? 'X and Y pitches differ by no more than 1%. Exact axis values are shown; confirm the product specification before using one nominal pitch.'
          : 'X and Y pitches differ by more than 1%. These inputs do not describe one uniform pitch; check dimensions and pixel counts.';
        $('conversion-results').innerHTML = metric('Inferred pixel pitch',`X ${f(r.pitch.x_mm)} mm<br>Y ${f(r.pitch.y_mm)} mm`,'Active width / pixel width and active height / pixel height.','conversion-pitch-result') +
          `<div id="conversion-pitch-warning" class="${r.consistent ? 'conversion-pitch-note' : 'warning'}" data-consistent="${r.consistent}">${warning}</div>` +
          `<div class="card conversion-detail"><h3>Axis comparison</h3>${row('X pitch',`${f(r.active.width_mm)} mm ÷ ${f(r.pixels.width)} px = ${f(r.pitch.x_mm)} mm`)}${row('Y pitch',`${f(r.active.height_mm)} mm ÷ ${f(r.pixels.height)} px = ${f(r.pitch.y_mm)} mm`)}${row('Relative X / Y difference',`${f(r.relativeDifference * 100)}%`)}<p class="helper">Difference is |pitch X − pitch Y| ÷ the larger pitch. No averaged pitch is substituted.</p></div>`;
      }
    } catch (error) {
      $('conversion-error').textContent = error.message;
      $('conversion-error').hidden = false;
      $('conversion-results').hidden = true;
      $('conversion-results').innerHTML = '';
    }
    persist();
  }
  function fill() {
    $('conversion-mode').value = state.mode;
    for (const key of fields) $(ids[key]).value = state[key];
    update();
  }
  $('conversion-mode').addEventListener('change', e => { state.mode = e.target.value; update(); });
  for (const key of fields) $(ids[key]).addEventListener('input', e => { state[key] = e.target.value; update(); });
  $('conversion-example-p15').addEventListener('click', () => { state = { ...defaults, mode: 'pixels_to_size' }; fill(); });
  $('conversion-example-fractional').addEventListener('click', () => { state = { ...defaults, mode: 'size_to_pixels', width_mm: '3000', height_mm: '1700' }; fill(); });
  fill();
}
