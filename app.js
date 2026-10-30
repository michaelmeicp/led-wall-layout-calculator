import { normalizePanel, parseLibrary, calculate, alignmentName, gapText, powerText, resolveAlignment, resolveCompositionLocked } from './core.js';
import { renderDiagram, summaryText, downloadPNG } from './diagram.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number(value).toLocaleString('en-US', {maximumFractionDigits: 3});
const ratio = (w,h) => h > 0 && w > 0 ? `${num(w/h)}:1` : '—';
const STORAGE = 'led-wall-layout-v1';
const seeds = [
  {id:'10000000-0000-4000-8000-000000000001',name:'Demo Wide 600',vendor:'Fictional example',active_width_mm:600,active_height_mm:337.5,resolution_w:384,resolution_h:216,pixel_pitch_mm:1.5625,rotatable:true,notes:'Example only. Not a real product.'},
  {id:'10000000-0000-4000-8000-000000000002',name:'Demo Square 300',vendor:'Fictional example',active_width_mm:300,active_height_mm:300,resolution_w:192,resolution_h:192,pixel_pitch_mm:1.5625,rotatable:true,notes:'Example only. Not a real product.'},
  {id:'10000000-0000-4000-8000-000000000003',name:'Demo Inset 500',vendor:'Fictional example',active_width_mm:480,active_height_mm:480,frame_width_mm:500,frame_height_mm:500,resolution_w:240,resolution_h:240,pixel_pitch_mm:2,rotatable:false,notes:'Fictional 10 mm centered inset on all sides.'}
].map(normalizePanel);
const defaults = {wall:{name:'Main stage',width_mm:4800,height_mm:2700},mode:'single',strategy:'fit_inside',alignment:'center',compositionLocked:false,split:{direction:'vertical',offset_mm:2400},zones:[{panelId:seeds[0].id,rotated:false},{panelId:seeds[1].id,rotated:false}]};
let panels = structuredClone(seeds), config = structuredClone(defaults), result = null, editingId = null;
let storageAvailable = true;
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    const data = JSON.parse(saved);
    panels = parseLibrary({version:1,panels:data.panels});
    if (data.config && typeof data.config === 'object') {
      config = {...defaults,...data.config,wall:{...defaults.wall,...data.config.wall},split:{...defaults.split,...data.config.split}};
      config.alignment = resolveAlignment(data.config);
      config.compositionLocked = resolveCompositionLocked(data.config);
      config.zones = [0,1].map(i => { const zone = {...defaults.zones[i],...data.config.zones?.[i]}; delete zone.alignment; return zone; });
    }
  }
} catch (error) {
  storageAvailable = false;
  $('storage-status').textContent = '● Saved data unavailable';
  $('action-status').textContent = `Saved session could not be loaded: ${error.message}. Working in memory; export your library to keep a copy.`;
}

function persist() {
  if (!storageAvailable) return;
  try { localStorage.setItem(STORAGE, JSON.stringify({version:1,panels,config})); }
  catch { storageAvailable = false; $('storage-status').textContent = '● Session in memory only'; $('action-status').textContent = 'Device storage is unavailable or full. Export your panel library before closing this page.'; }
}

function fillControls() {
  $('wall-name').value = config.wall.name;
  $('wall-width').value = config.wall.width_mm;
  $('wall-height').value = config.wall.height_mm;
  const mode = document.querySelector(`input[name="mode"][value="${config.mode === 'two_zones' ? 'two_zones' : 'single'}"]`);
  mode.checked = true;
  config.mode = mode.value;
  $('fit-strategy').value = config.strategy;
  $('layout-alignment').value = config.alignment;
  $('split-direction').value = config.split.direction;
  $('split-offset').value = config.split.offset_mm;
  renderSelectors();
}

function renderSelectors() {
  const split = config.mode === 'two_zones';
  $('split-controls').hidden = !split;
  $('offset-label').textContent = config.split.direction === 'horizontal' ? 'Cut from bottom (mm)' : 'Cut from left (mm)';
  const labels = split ? (config.split.direction === 'horizontal' ? ['A · Bottom zone','B · Top zone'] : ['A · Left zone','B · Right zone']) : ['A · Whole wall'];
  $('zone-selectors').innerHTML = labels.map((label,i) => {
    const zone = config.zones[i];
    const panel = panels.find(p=>p.id===zone.panelId);
    const colorIndex = config.zones.slice(0,i).some(z=>z.panelId===zone.panelId) ? 0 : i;
    return `<div class="zone-picker"><div class="zone-heading"><i class="swatch ${colorIndex ? 'swatch-b' : ''}"></i>${label}</div><div class="zone-fields"><label>Panel model<select data-zone="${i}" data-field="panelId" aria-label="${label} panel"><option value="" ${!panel ? 'selected' : ''} disabled>Select a panel</option>${panels.map(p=>`<option value="${esc(p.id)}" ${p.id===zone.panelId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Orientation<select data-zone="${i}" data-field="rotated" aria-label="${label} orientation"><option value="false" ${!zone.rotated?'selected':''}>0° · Native</option><option value="true" ${zone.rotated?'selected':''} ${panel?.rotatable?'':'disabled'}>90° · Rotate</option></select></label></div>${panel ? `<p class="panel-facts">Frame ${num(panel.frame_width_mm)} × ${num(panel.frame_height_mm)} mm · ${num(panel.resolution_w)} × ${num(panel.resolution_h)} px${panel.rotatable?'':' · fixed orientation'}<br>Power per cabinet: typical ${panel.typical_power_w === null ? 'unknown' : num(panel.typical_power_w)+' W'} · max ${panel.max_power_w === null ? 'unknown' : num(panel.max_power_w)+' W'}</p>` : '<p class="panel-facts">Add or choose a valid panel from your library.</p>'}</div>`;
  }).join('');
}

function renderLockState() {
  const locked = config.compositionLocked;
  for (const id of ['wall-width','wall-height','split-direction','split-offset','fit-strategy','add-panel','import-library','import-file']) $(id).disabled = locked;
  document.querySelectorAll('input[name="mode"], #zone-selectors select, #panel-form input, #panel-form textarea, #panel-form button').forEach(input => { input.disabled = locked; });
  document.querySelectorAll('#library-list button[data-action="duplicate"], #library-list button[data-action="delete"]').forEach(button => { button.disabled = locked; });
  $('composition-lock').textContent = locked ? 'Unlock composition' : 'Lock composition';
  $('composition-lock').setAttribute('aria-pressed',String(locked));
  $('composition-lock').disabled = !locked && (!result || !result.totalCount);
  $('composition-status').textContent = locked
    ? 'Locked on this device. Wall size, cabinet choices, sizing split, fit and panel library are held. Choose any position to move the complete group; unlock to edit its composition.'
    : 'Set the wall size, A / B cabinets and fit first. Lock a valid composition to hold its size and arrangement, then move the whole group. The lock is saved with this session.';
  $('library-lock-status').hidden = !locked;
  document.querySelectorAll('[data-anchor]').forEach(button => { button.setAttribute('aria-pressed',String(button.dataset.anchor === config.alignment)); });
}

function compositionEditBlocked() {
  if (!config.compositionLocked) return false;
  $('action-status').textContent = 'Composition is locked. Unlock it before changing sizes, cabinet choices or the panel library.';
  fillControls();
  renderLockState();
  return true;
}

function row(label,value) {return `<div class="result-row"><span>${label}</span><strong>${value}</strong></div>`;}
function renderResults(r) {
  const canvas = r.canvas.combined && r.canvas.width > 0 && r.canvas.height > 0 ? `${num(r.canvas.width)} × ${num(r.canvas.height)}` : (r.totalCount ? 'Per zone' : 'No pixels');
  $('results').innerHTML = `<div class="metric-grid"><div class="metric"><div class="label">Total cabinets</div><div class="value">${num(r.totalCount)}</div><div class="hint">${r.counts.map(p=>`${num(p.count)} ${esc(p.name)}`).join(' + ') || 'No cabinets fit'}</div></div><div class="metric"><div class="label">${r.mode==='single'?'LED resolution':'Pixel canvas'}</div><div class="value" style="font-size:${canvas.length > 15?'18':'22'}px">${canvas}</div><div class="hint">${r.canvas.combined?'pixels · aligned canvas':'See zone resolutions below'}</div></div><div class="metric"><div class="label">Utilization</div><div class="value">${num(r.utilization*100)}<small>%</small></div><div class="hint">Cabinet footprint / target area</div></div></div>
  <div class="card result-card group-result"><h3>Whole-layout placement</h3><div class="result-table">${row('Composition',r.compositionLocked?'Locked':'Unlocked')}${row('Position',alignmentName(r.group.alignment))}${row('Group footprint',`${num(r.group.width)} × ${num(r.group.height)} mm`)}${row('Left gap',gapText(r.group.gaps.left))}${row('Right gap',gapText(r.group.gaps.right))}${row('Top gap',gapText(r.group.gaps.top))}${row('Bottom gap',gapText(r.group.gaps.bottom))}</div><p class="helper">${r.mode==='single'?'The cabinet grid moves as one group.':r.split.direction==='vertical'?'A and B join edge to edge, left to right, with their bottom edges aligned.':'A and B join edge to edge, bottom to top, with their left edges aligned.'} All four gaps measure the assembled outer frame bounds to the wall.${!r.totalCount?' No cabinets installed; clearances are illustrative.':''}</p></div>
  <div class="card result-card">${r.zones.map((z,i)=>`<div class="zone-result"><h3><i class="swatch ${i && z.panel.id!==r.zones[0].panel.id?'swatch-b':''}"></i>${esc(z.label)} <span class="optional">${esc(z.panel.name)} · ${z.rotated?'90° rotated':'0° native'}</span></h3><div class="result-table">${row('Cabinet grid',`${num(z.nx)} × ${num(z.ny)} · ${num(z.count)} cabinets`)}${row('Sizing allocation',`${num(z.width)} × ${num(z.height)} mm`)}${row('Actual footprint',`${num(z.actualWidth)} × ${num(z.actualHeight)} mm`)}${row('Resolution',`${num(z.resolutionW)} × ${num(z.resolutionH)} px`)}${row('Frame origin (wall X / Y)',`${num(z.actualX)} / ${num(z.actualY)} mm`)}${row('Typical / average power',powerText(z.power.typical))}${row('Maximum power',powerText(z.power.maximum))}${row('Active aggregate',`${num(z.activeWidth)} × ${num(z.activeHeight)} mm`)}${row('LED aspect ratio',ratio(z.activeWidth,z.activeHeight))}${row('Allocation utilization',`${num(z.utilization*100)}%`)}${row('Derived pitch X / Y',`${num(z.panel.active_width_mm/z.panel.resolution_w)} / ${num(z.panel.active_height_mm/z.panel.resolution_h)} mm`)}</div></div>`).join('')}
  <div class="result-table" style="margin-top:16px">${row('Target wall ratio',ratio(r.wall.width_mm,r.wall.height_mm))}</div>
  <div class="mapping ${r.canvas.combined?'':'separate'}"><strong>${r.canvas.combined?'Aligned pixel canvas':'Processor mapping / two canvases'}</strong>${esc(r.canvas.reason)}</div>
  </div><div class="card result-card power-card"><h3>Whole-wall power</h3><div class="result-table">${row('Typical / average',powerText(r.power.typical))}${row('Maximum',powerText(r.power.maximum))}</div><p class="helper">Installed cabinet count × your per-cabinet ratings. Unknown ratings are excluded from partial totals.</p><details class="sku-power"><summary>Power by panel model (SKU)</summary>${r.counts.map(c=>`<div class="sku-power-item"><h4>${esc(c.name)} <span class="optional">${num(c.count)} cabinets</span></h4><div class="result-table">${row('Typical / average',powerText(c.power.typical))}${row('Maximum',powerText(c.power.maximum))}</div></div>`).join('')}</details></div>${r.warnings.length?`<div class="warnings">${r.warnings.map(w=>`<div class="warning ${w.level==='red'?'red':''}"><strong aria-hidden="true">${w.level==='red'?'!':'△'}</strong><span>${esc(w.message)}</span></div>`).join('')}</div>`:''}`;
}

function update() {
  $('strategy-help').textContent = {
    fit_inside:'Fit inside uses whole cabinets within each sizing allocation. The fitted grids join as one group, then move together to the chosen wall position.',
    cover_wall:'Cover wall rounds both axes up. The fitted grids join as one group; its position sets which wall edges overflow. Center shares overflow on opposite edges.',
    exact_only:'Exact accepts the nearest positive integer footprint within 0.5 mm on each axis. A tiny accepted difference may remain.'
  }[config.strategy] || '';
  try {
    result = calculate({...config,zones:config.zones.slice(0,config.mode==='single'?1:2)},panels);
    $('error').hidden = true;
    $('diagram').innerHTML = renderDiagram(result);
    renderResults(result);
    $('export-png').disabled = false;
    $('copy-summary').disabled = false;
  } catch (error) {
    result = null;
    $('error').textContent = error.message;
    $('error').hidden = false;
    $('diagram').innerHTML = '<div class="empty-state">Adjust the inputs to generate a valid wall plan.</div>';
    $('results').innerHTML = '';
    $('export-png').disabled = true;
    $('copy-summary').disabled = true;
  }
  renderLockState();
  persist();
}

for (const [id,key] of [['wall-name','name'],['wall-width','width_mm'],['wall-height','height_mm']]) {
  $(id).addEventListener('input',e=>{if(key!=='name' && compositionEditBlocked())return;config.wall[key]=key==='name'?e.target.value:e.target.value === '' ? '' : Number(e.target.value); update();});
}
document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener('change',e=>{if(compositionEditBlocked())return;config.mode=e.target.value;renderSelectors();update();}));
$('layout-alignment').addEventListener('change',e=>{config.alignment=e.target.value;update();});
document.querySelectorAll('[data-anchor]').forEach(button=>button.addEventListener('click',()=>{config.alignment=button.dataset.anchor;$('layout-alignment').value=config.alignment;update();}));
$('composition-lock').addEventListener('click',()=>{if(!config.compositionLocked && (!result || !result.totalCount))return;config.compositionLocked=!config.compositionLocked;update();});
$('fit-strategy').addEventListener('change',e=>{if(compositionEditBlocked())return;config.strategy=e.target.value;update();});
$('split-direction').addEventListener('change',e=>{if(compositionEditBlocked())return;config.split.direction=e.target.value;renderSelectors();update();});
$('split-offset').addEventListener('input',e=>{if(compositionEditBlocked())return;config.split.offset_mm=e.target.value === '' ? '' : Number(e.target.value);update();});
$('zone-selectors').addEventListener('change',e=>{
  const {zone,field} = e.target.dataset;
  if (zone===undefined || compositionEditBlocked()) return;
  config.zones[Number(zone)][field] = field==='rotated' ? e.target.value==='true' : e.target.value;
  if(field==='panelId' && !panels.find(p=>p.id===e.target.value)?.rotatable) config.zones[Number(zone)].rotated=false;
  renderSelectors(); update();
});

const panelForm = $('panel-form');
const numericFields = ['active_width_mm','active_height_mm','frame_width_mm','frame_height_mm','resolution_w','resolution_h','pixel_pitch_mm','typical_power_w','max_power_w'];
function editPanel(id) {
  editingId=id;
  const panel = panels.find(p=>p.id===id);
  panelForm.reset();
  $('panel-id').value=id||'';
  $('editor-title').textContent = panel?'Edit panel':'New panel';
  for(const key of ['name','vendor','notes',...numericFields]) panelForm.elements[key].value=panel?.[key]??'';
  panelForm.elements.rotatable.checked=panel?.rotatable??false;
  $('panel-error').hidden=true;
  renderLibrary();
  renderLockState();
}
function renderLibrary() {
  $('library-list').innerHTML = panels.length ? panels.map(p=>`<article class="library-item ${editingId===p.id?'selected':''}"><h3>${esc(p.name)}</h3><p>${esc(p.vendor||'No vendor')} · ${num(p.frame_width_mm)} × ${num(p.frame_height_mm)} mm</p><p>${num(p.resolution_w)} × ${num(p.resolution_h)} px · ${p.rotatable?'rotatable':'fixed'}</p><p>Typical ${p.typical_power_w === null ? 'unknown' : num(p.typical_power_w)+' W'} · Max ${p.max_power_w === null ? 'unknown' : num(p.max_power_w)+' W'}</p><div class="actions"><button type="button" data-action="edit" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">Edit</button><button type="button" data-action="duplicate" data-id="${p.id}" aria-label="Duplicate ${esc(p.name)}">Duplicate</button><button type="button" class="delete" data-action="delete" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">Delete</button></div></article>`).join('') : '<p class="helper">Your library is empty. Add a panel to begin.</p>';
}
$('manage-library').addEventListener('click',()=>{editPanel(panels[0]?.id||null);$('library-dialog').showModal();});
$('close-library').addEventListener('click',()=>$('library-dialog').close());
$('add-panel').addEventListener('click',()=>{if(compositionEditBlocked())return;editPanel(null);panelForm.elements.name.focus();});
$('library-list').addEventListener('click',e=>{
  const button=e.target.closest('button[data-action]'); if(!button)return;
  const {action,id}=button.dataset, panel=panels.find(p=>p.id===id); if(!panel)return;
  if(action==='edit') {editPanel(id);return;}
  if(compositionEditBlocked())return;
  if(action==='duplicate') {
    const copy=normalizePanel({...panel,id:crypto.randomUUID(),name:`${panel.name.slice(0,155)} copy`});
    panels.push(copy);editPanel(copy.id);$('library-status').textContent=`Duplicated ${panel.name}.`;
  }
  if(action==='delete') {
    panels=panels.filter(p=>p.id!==id);
    for(const zone of config.zones) if(zone.panelId===id){zone.panelId=panels[0]?.id||'';zone.rotated=false;}
    editPanel(panels[0]?.id||null);$('library-status').textContent=`Deleted ${panel.name}. Selected zones now use the first available panel.`;
  }
  renderSelectors();update();
});
panelForm.addEventListener('submit',e=>{
  e.preventDefault();
  if(compositionEditBlocked()){editPanel(editingId);return;}
  try {
    const raw={id:editingId||crypto.randomUUID(),rotatable:panelForm.elements.rotatable.checked};
    for(const key of ['name','vendor','notes'])raw[key]=panelForm.elements[key].value;
    for(const key of numericFields)raw[key]=panelForm.elements[key].value===''?undefined:Number(panelForm.elements[key].value);
    const panel=normalizePanel(raw);
    const index=panels.findIndex(p=>p.id===panel.id);
    if(index<0)panels.push(panel);else panels[index]=panel;
    if(panels.length===1)config.zones.forEach(z=>{z.panelId=panel.id;z.rotated=false;});
    editPanel(panel.id);
    $('library-status').textContent=`Saved ${panel.name}.${panel.warnings.length?' '+panel.warnings.map(w=>typeof w==='string'?w:w.message).join(' '):''}`;
    renderSelectors();update();
  } catch(error){$('panel-error').textContent=error.message;$('panel-error').hidden=false;}
});
function downloadFile(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-library').addEventListener('click',()=>{
  try {downloadFile(new Blob([JSON.stringify({version:1,panels:panels.map(({warnings,...p})=>p)},null,2)],{type:'application/json'}),'led-panel-library.json');$('library-status').textContent='Panel library exported.';}catch(error){$('library-status').textContent=`Export failed: ${error.message}`;}
});
$('import-library').addEventListener('click',()=>{if(!compositionEditBlocked())$('import-file').click();});
$('import-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  if(compositionEditBlocked()){e.target.value='';return;}
  try {
    const contents=await file.text();
    if(compositionEditBlocked()){e.target.value='';return;}
    const incoming=parseLibrary(contents);
    const merged=new Map(panels.map(p=>[p.id,p]));
    for(const p of incoming)merged.set(p.id,p);
    panels=[...merged.values()];
    if(!config.zones[0].panelId && panels[0])config.zones.forEach(z=>{z.panelId=panels[0].id;z.rotated=false;});
    editPanel(incoming[0]?.id||panels[0]?.id||null);
    $('library-status').textContent=`Imported ${incoming.length} panels. Matching IDs were replaced.`;
    renderSelectors();update();
  }catch(error){$('library-status').textContent=`Import rejected. Library unchanged. ${error.message}`;}
  e.target.value='';
});
$('export-png').addEventListener('click',async()=>{
  if(!result)return;
  const snapshot=result;
  $('export-png').disabled=true;$('action-status').textContent='Preparing report image…';
  try {await downloadPNG(snapshot);$('action-status').textContent='PNG report exported with zone results and warnings.';}
  catch(error){$('action-status').textContent=`PNG export failed: ${error.message}. Use Copy summary or browser Print to keep the plan.`;}
  finally{$('export-png').disabled=!result;}
});
$('copy-summary').addEventListener('click',async()=>{
  if(!result)return;
  const text=summaryText(result);
  try {if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);$('action-status').textContent='Complete plan summary copied.';}
  catch {$('copy-text').value=text;$('copy-dialog').showModal();$('copy-text').focus();$('copy-text').select();$('action-status').textContent='Clipboard access unavailable. The complete summary is ready to select and copy.';}
});
$('close-copy').addEventListener('click',()=>$('copy-dialog').close());
$('select-summary').addEventListener('click',()=>{$('copy-text').focus();$('copy-text').select();});
fillControls();update();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{$('action-status').textContent='Offline cache unavailable. Keep this page open, or use an HTTPS / localhost address for offline support.';});
