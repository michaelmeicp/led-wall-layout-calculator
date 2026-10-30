import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname,'..');
await mkdir(resolve(root,'qa'),{recursive:true});
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,`.${pathname.endsWith('/')?pathname+'index.html':pathname}`);
    if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];
const check=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const snapshot=()=>page.evaluate(async()=>{
  const {calculate}=await import('./core.js');
  const saved=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
  return calculate({...saved.config,zones:saved.config.zones.slice(0,saved.config.mode==='single'?1:2)},saved.panels);
});
const alignment=()=>page.locator('#layout-alignment');
const alignments=['center','top_left','top_right','bottom_left','bottom_right'];
function assertGroupPlacement(result,value) {
  const {group,wall}=result;
  const dx=wall.width_mm-group.width,dy=wall.height_mm-group.height;
  const left=value==='center'?dx/2:value.endsWith('right')?dx:0;
  const bottom=value==='center'?dy/2:value.startsWith('top')?dy:0;
  assert.equal(group.alignment,value);
  assert.equal(group.x,left);assert.equal(group.y,bottom);
  assert.deepEqual(group.gaps,{left,right:dx-left,top:dy-bottom,bottom});
}
try {
  await page.goto(url);
  await page.waitForSelector('#diagram svg');
  assert.equal(await page.locator('.metric .value').first().textContent(),'64');
  assert.equal(await page.locator('#error').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(root,'qa/desktop.png'),fullPage:true});
  check('desktop default decimal cabinet grid and layout');

  assert.equal(await alignment().inputValue(),'center');
  assert.equal(await page.locator('[data-zone][data-field="alignment"]').count(),0);
  await page.locator('#wall-width').fill('2500');
  await page.locator('#wall-height').fill('1500');
  for(const [value,expected] of [
    ['center',{left:50,right:50,top:75,bottom:75}],
    ['top_left',{left:0,right:100,top:0,bottom:150}],
    ['top_right',{left:100,right:0,top:0,bottom:150}],
    ['bottom_left',{left:0,right:100,top:150,bottom:0}],
    ['bottom_right',{left:100,right:0,top:150,bottom:0}],
  ]) {
    await alignment().selectOption(value);
    const current=await snapshot();
    assert.deepEqual(current.group.gaps,expected,`${value} uses frame dimensions`);
    assertGroupPlacement(current,value);
    assert.equal(current.zones[0].actualX,expected.left);
    assert.equal(current.zones[0].actualY,expected.bottom);
    const results=await page.locator('#results').textContent();
    for(const edge of ['Left','Right','Top','Bottom'])assert.match(results,new RegExp(`${edge} gap`,'i'));
    for(const gap of Object.values(expected))assert.ok(results.includes(`${gap} mm`));
    const drawing=await page.locator('#diagram').textContent();
    for(const edge of ['Left','Right','Top','Bottom'])assert.ok(drawing.includes(edge));
  }
  await alignment().selectOption('center');
  await page.locator('#fit-strategy').selectOption('cover_wall');
  let current=await snapshot();
  assert.deepEqual(current.group.gaps,{left:-250,right:-250,top:-93.75,bottom:-93.75});
  assert.match(await page.locator('#results').textContent(),/250 mm overflow/);
  assert.match(await page.locator('#diagram').textContent(),/overflow/);
  await page.locator('[data-zone="0"][data-field="rotated"]').selectOption('true');
  current=await snapshot();
  assert.equal(current.zones[0].panel.frame_width_mm,337.5);
  assert.equal(current.zones[0].panel.frame_height_mm,600);
  assert.deepEqual(current.group.gaps,{left:-100,right:-100,top:-150,bottom:-150});
  await page.locator('[data-zone="0"][data-field="rotated"]').selectOption('false');
  await page.locator('#fit-strategy').selectOption('fit_inside');
  await page.locator('#wall-width').fill('4800');
  await page.locator('#wall-height').fill('2700');
  check('center and four corners show signed frame gaps, overflow and rotated offsets');

  await page.getByLabel('Two zones',{exact:true}).check();
  await page.locator('.zone-result').nth(1).waitFor();
  assert.match(await page.locator('#results').textContent(),/3,072 × 1,728/);
  assert.match(await page.locator('#results').textContent(),/104/);
  assert.match(await page.locator('.mapping').textContent(),/Aligned pixel canvas/);
  await page.screenshot({path:resolve(root,'qa/two-zones.png'),fullPage:true});
  check('two-zone mixed 600 × 337.5 / 300 × 300 aligned canvas');

  await page.locator('#wall-width').fill('2800');
  await page.locator('#wall-height').fill('1575');
  for(const [direction,cut,size,relative] of [
    ['vertical','1250',{width:2700,height:1500},{x:1200,y:0}],
    ['horizontal','700',{width:2700,height:1275},{x:0,y:675}],
  ]) {
    await page.locator('#split-direction').selectOption(direction);
    await page.locator('#split-offset').fill(cut);
    const footprints=[];
    for(const value of alignments) {
      await alignment().selectOption(value);
      const assembled=await snapshot();
      assertGroupPlacement(assembled,value);
      assert.equal(assembled.group.width,size.width);
      assert.equal(assembled.group.height,size.height);
      const [a,b]=assembled.zones;
      assert.equal(b.actualX-a.actualX,relative.x,`${direction}: X relation must not change at ${value}`);
      assert.equal(b.actualY-a.actualY,relative.y,`${direction}: Y relation must not change at ${value}`);
      if(direction==='vertical') {
        assert.equal(a.actualX+a.actualWidth,b.actualX,'packed vertical grids touch');
        assert.equal(a.actualY,b.actualY,'vertical grids share bottom edge');
        assert.notEqual(a.actualHeight,b.actualHeight,'exercise stepped top outline');
      } else {
        assert.equal(a.actualY+a.actualHeight,b.actualY,'packed horizontal grids touch');
        assert.equal(a.actualX,b.actualX,'horizontal grids share left edge');
        assert.notEqual(a.actualWidth,b.actualWidth,'exercise stepped right outline');
      }
      assert.equal('gaps' in a,false,'edge gaps belong to the whole assembly');
      assert.equal('alignment' in a,false,'zones have no independent alignment');
      footprints.push(assembled.zones.map(z=>[z.nx,z.ny,z.actualWidth,z.actualHeight]));
    }
    footprints.forEach(f=>assert.deepEqual(f,footprints[0],'alignment only translates the entire assembled group'));
    await alignment().selectOption('center');
    assert.match(await page.locator('.mapping').textContent(),/Processor mapping/);
    await page.screenshot({path:resolve(root,`qa/group-${direction}.png`),fullPage:true});
  }
  await page.locator('#split-direction').selectOption('vertical');
  await page.locator('#split-offset').fill('1250');
  await page.locator('[data-zone="0"][data-field="rotated"]').selectOption('true');
  for(const value of alignments) {
    await alignment().selectOption(value);
    const rotated=await snapshot();
    assertGroupPlacement(rotated,value);
    assert.equal(rotated.group.width,2512.5);
    assert.equal(rotated.group.height,1500);
    assert.equal(rotated.zones[0].actualX+1012.5,rotated.zones[1].actualX);
    assert.equal(rotated.zones[0].actualY,rotated.zones[1].actualY);
  }
  await page.locator('[data-zone="0"][data-field="rotated"]').selectOption('false');
  await alignment().selectOption('center');
  await page.locator('#wall-width').fill('4800');
  await page.locator('#wall-height').fill('2700');
  await page.locator('#split-direction').selectOption('vertical');
  check('unequal vertical, horizontal and rotated grids stay joined at all five whole-group positions');

  await page.locator('#split-offset').fill('2500');
  await page.locator('#fit-strategy').selectOption('cover_wall');
  for(const value of alignments) {
    await alignment().selectOption(value);
    current=await snapshot();
    assertGroupPlacement(current,value);
    assert.equal(current.zones[0].actualX+current.zones[0].actualWidth,current.zones[1].actualX);
    assert.equal(current.zones[0].actualY,current.zones[1].actualY);
    assert.ok(Object.values(current.group.gaps).some(g=>g<0));
    assert.match(await page.locator('.warnings').textContent(),/overflow/i);
    assert.doesNotMatch(await page.locator('.warnings').textContent(),/overlaps|crosses the split/i);
  }
  await alignment().selectOption('center');
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#export-png').click();
  const image=await downloadEvent;
  await image.saveAs(resolve(root,'qa/two-zone-report.png'));
  const png=await readFile(resolve(root,'qa/two-zone-report.png'));
  assert.equal(png.readUInt32BE(16),1800);
  assert.ok(png.readUInt32BE(20)>1000);
  assert.ok(png.length>40000);
  const report=await page.evaluate(async()=>{
    const {renderDiagram}=await import('./diagram.js');const {calculate}=await import('./core.js');
    const saved=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    return renderDiagram(calculate(saved.config,saved.panels),{report:true});
  });
  for(const word of ['Left zone','Right zone','overflow','LAYOUT WARNINGS','Counts by SKU','Left','Right','Top','Bottom','Unknown'])assert.ok(report.includes(word),word);
  assert.match(report,/alignment/i);
  assert.match(report,/power/i);
  check('cover overflow applies to the assembled group without overlapping grids; full PNG downloads');

  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('#copy-summary').click();
  const clipboard=await page.evaluate(()=>navigator.clipboard.readText());
  for(const word of ['Target:','from LEFT','Left zone','Right zone','Grid:','Per-zone resolution:','Actual frame footprint:','overflow','Left','Right','Top','Bottom','Unknown'])assert.ok(clipboard.includes(word),word);
  assert.match(clipboard,/alignment/i);
  assert.match(clipboard,/power/i);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Test denied');};});
  await page.locator('#copy-summary').click();
  assert.equal(await page.locator('#copy-dialog').isVisible(),true);
  assert.match(await page.locator('#copy-text').inputValue(),/Right zone/);
  await page.locator('#close-copy').click();
  check('actual clipboard copy and graceful manual-copy fallback');

  await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};});
  await page.locator('#export-png').click();
  await page.waitForFunction(()=>document.getElementById('action-status').textContent.includes('PNG export failed'));
  assert.equal(await page.locator('#export-png').isEnabled(),true);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.originalToBlob;});
  check('PNG encoding failure gives recovery message and re-enables export');

  await page.locator('#manage-library').click();
  const initial=await page.locator('.library-item').count();
  await page.locator('#add-panel').click();
  const form=page.locator('#panel-form');
  await form.locator('[name="name"]').fill('Browser test cabinet');
  await form.locator('[name="active_width_mm"]').fill('400');
  await form.locator('[name="active_height_mm"]').fill('200');
  await form.locator('[name="frame_width_mm"]').fill('390');
  await form.locator('[name="pixel_pitch_mm"]').fill('2');
  await form.getByRole('button',{name:'Save panel'}).click();
  assert.match(await page.locator('#panel-error').textContent(),/Frame/);
  assert.equal(await page.locator('.library-item').count(),initial);
  await form.locator('[name="frame_width_mm"]').fill('');
  await form.getByRole('button',{name:'Save panel'}).click();
  assert.equal(await page.locator('.library-item').count(),initial+1);
  assert.equal(await form.locator('[name="resolution_w"]').inputValue(),'200');
  await page.getByRole('button',{name:'Duplicate Browser test cabinet',exact:true}).click();
  assert.equal(await page.locator('.library-item').count(),initial+2);
  await form.locator('[name="name"]').fill('Browser edited');
  await form.getByRole('button',{name:'Save panel'}).click();
  await page.getByRole('button',{name:'Delete Browser edited',exact:true}).click();
  assert.equal(await page.locator('.library-item').count(),initial+1);
  const jsonEvent=page.waitForEvent('download');
  await page.locator('#export-library').click();
  const jsonDownload=await jsonEvent;
  await jsonDownload.saveAs(resolve(root,'qa/library.json'));
  const exported=JSON.parse(await readFile(resolve(root,'qa/library.json'),'utf8'));
  assert.equal(exported.panels.length,initial+1);
  await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"panels":[{"name":"invalid"}]}')});
  await page.waitForFunction(()=>document.getElementById('library-status').textContent.includes('Import rejected'));
  assert.match(await page.locator('#library-status').textContent(),/Import rejected/);
  assert.equal(await page.locator('.library-item').count(),initial+1);
  await page.locator('#import-file').setInputFiles(resolve(root,'qa/library.json'));
  await page.waitForFunction(()=>document.getElementById('library-status').textContent.includes('Imported'));
  assert.match(await page.locator('#library-status').textContent(),/Imported/);
  assert.equal(await page.locator('.library-item').count(),initial+1);
  await page.getByRole('button',{name:'Edit Browser test cabinet',exact:true}).click();
  await form.locator('[name="name"]').fill('W'.repeat(160));
  await form.getByRole('button',{name:'Save panel'}).click();
  await page.getByRole('button',{name:`Duplicate ${'W'.repeat(160)}`,exact:true}).click();
  assert.equal(await form.locator('[name="name"]').inputValue(),`${'W'.repeat(155)} copy`);
  await page.getByRole('button',{name:`Delete ${'W'.repeat(155)} copy`,exact:true}).click();
  await page.locator('#close-library').click();
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await page.locator('#split-offset').inputValue(),'2500');
  await page.locator('#manage-library').click();
  assert.equal(await page.locator('.library-item').count(),initial+1);
  await page.locator('#close-library').click();
  check('library add/edit/duplicate/delete, derived resolution, JSON validation/merge/export, session persistence');

  const clipping=await page.evaluate(async()=>{
    const {renderDiagram}=await import('./diagram.js');const {calculate}=await import('./core.js');
    const data=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    data.config.wall.name='W'.repeat(160);
    data.panels.forEach((p,i)=>p.name=(i%2?'牆':'W').repeat(160));
    const host=document.createElement('div');host.style.cssText='position:absolute;visibility:hidden;left:0;top:0';
    host.innerHTML=renderDiagram(calculate(data.config,data.panels),{report:true});document.body.append(host);
    const svg=host.querySelector('svg');
    const outside=[...svg.querySelectorAll('text')].filter(text=>{
      const b=text.getBBox(),m=text.getCTM();
      return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m)).some(p=>p.x < -1 || p.x > svg.width.baseVal.value+1);
    }).map(t=>t.textContent);
    const fullName=svg.textContent.replace(/\s/g,'').includes(data.config.wall.name);
    host.remove();return {outside,fullName};
  });
  assert.deepEqual(clipping.outside,[]);assert.equal(clipping.fullName,true);
  check('max-length wide Latin/CJK report names wrap without clipping');

  // User-entered ratings are optional: unknown is distinct from an explicit 0 W.
  await page.locator('#manage-library').click();
  await page.getByRole('button',{name:'Edit Demo Wide 600',exact:true}).click();
  await form.locator('[name="typical_power_w"]').fill('100');
  await form.locator('[name="max_power_w"]').fill('90');
  await form.getByRole('button',{name:'Save panel'}).click();
  assert.equal(await page.locator('#panel-error').isVisible(),true);
  assert.match(await page.locator('#panel-error').textContent(),/maximum|max power|at least/i);
  await form.locator('[name="max_power_w"]').fill('-1');
  await form.getByRole('button',{name:'Save panel'}).click();
  assert.match(await page.locator('#panel-error').textContent(),/non.?negative|zero|0|positive/i);
  await form.locator('[name="max_power_w"]').fill('200');
  await form.getByRole('button',{name:'Save panel'}).click();
  assert.equal(await page.locator('#panel-error').isVisible(),false);
  await page.locator('#close-library').click();
  await page.locator('#fit-strategy').selectOption('fit_inside');
  await page.locator('#split-offset').fill('2400');
  await alignment().selectOption('top_right');
  current=await snapshot();
  assert.equal(current.zones[0].power.typical.watts,3200);
  assert.equal(current.zones[1].power.typical.status,'unknown');
  assert.equal(current.power.typical.status,'partial');
  assert.equal(current.power.typical.knownCount,32);
  assert.equal(current.power.typical.totalCount,104);
  assert.equal(current.counts.find(c=>c.name==='Demo Wide 600').power.maximum.watts,6400);
  assert.match(await page.locator('#results').textContent(),/Partial/);
  assert.match(await page.locator('#results').textContent(),/3,200 W/);
  assert.match(await page.locator('#results').textContent(),/Unknown/);
  await page.getByLabel('Single panel',{exact:true}).check();
  current=await snapshot();
  assert.equal(current.power.typical.watts,6400);
  assert.equal(current.power.maximum.watts,12800);
  assert.equal(current.power.typical.status,'complete');
  const powerResults=await page.locator('#results').textContent();
  for(const text of ['6,400 W','6.4 kW','12,800 W','12.8 kW'])assert.ok(powerResults.includes(text),text);
  check('optional power validates inputs and totals installed cabinets by zone, SKU and wall');

  await page.locator('#manage-library').click();
  await page.getByRole('button',{name:'Edit Demo Square 300',exact:true}).click();
  await form.locator('[name="typical_power_w"]').fill('0');
  await form.locator('[name="max_power_w"]').fill('0');
  await form.getByRole('button',{name:'Save panel'}).click();
  const powerExportEvent=page.waitForEvent('download');
  await page.locator('#export-library').click();
  const powerExport=await powerExportEvent;
  await powerExport.saveAs(resolve(root,'qa/power-library.json'));
  const powerLibrary=JSON.parse(await readFile(resolve(root,'qa/power-library.json'),'utf8'));
  assert.equal(powerLibrary.version,1);
  assert.equal(powerLibrary.panels.find(p=>p.name==='Demo Wide 600').typical_power_w,100);
  assert.equal(powerLibrary.panels.find(p=>p.name==='Demo Wide 600').max_power_w,200);
  assert.equal(powerLibrary.panels.find(p=>p.name==='Demo Square 300').typical_power_w,0);
  const invalidPower=structuredClone(powerLibrary);
  invalidPower.panels[0].max_power_w='Infinity';
  await page.locator('#import-file').setInputFiles({name:'invalid-power.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalidPower))});
  await page.waitForFunction(()=>document.getElementById('library-status').textContent.includes('Import rejected'));
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('led-wall-layout-v1'))).panels[0].max_power_w,200);
  const legacyLibrary=structuredClone(powerLibrary);
  legacyLibrary.panels.forEach(p=>{delete p.typical_power_w;delete p.max_power_w;});
  await page.locator('#import-file').setInputFiles({name:'legacy-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacyLibrary))});
  await page.waitForFunction(()=>document.getElementById('library-status').textContent.includes('Imported'));
  await page.getByRole('button',{name:'Edit Demo Wide 600',exact:true}).click();
  assert.equal(await form.locator('[name="typical_power_w"]').inputValue(),'');
  assert.equal(await form.locator('[name="max_power_w"]').inputValue(),'');
  await page.locator('#import-file').setInputFiles(resolve(root,'qa/power-library.json'));
  await page.waitForFunction(()=>document.getElementById('library-status').textContent.includes('Imported'));
  await page.locator('#close-library').click();
  await page.getByLabel('Two zones',{exact:true}).check();
  current=await snapshot();
  assert.equal(current.zones[1].power.typical.status,'complete');
  assert.equal(current.zones[1].power.typical.watts,0);
  assert.equal(current.power.typical.status,'complete');
  assert.equal(current.power.typical.watts,3200);
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await alignment().inputValue(),'top_right');
  current=await snapshot();
  assert.equal(current.power.typical.watts,3200);
  assert.equal(current.power.maximum.watts,6400);
  await page.locator('#manage-library').click();
  await page.getByRole('button',{name:'Edit Demo Wide 600',exact:true}).click();
  assert.equal(await form.locator('[name="typical_power_w"]').inputValue(),'100');
  assert.equal(await form.locator('[name="max_power_w"]').inputValue(),'200');
  await page.locator('#close-library').click();
  check('power and whole-group alignment survive JSON import/export and session reload; explicit zero stays known');

  const savedWithPower=await page.evaluate(()=>localStorage.getItem('led-wall-layout-v1'));
  await page.evaluate(()=>{
    const previous=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    delete previous.config.alignment;
    previous.config.zones[0].alignment='center';
    previous.config.zones[1].alignment='bottom_right';
    localStorage.setItem('led-wall-layout-v1',JSON.stringify(previous));
  });
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await alignment().inputValue(),'center');
  current=await snapshot();
  assertGroupPlacement(current,'center');
  const migrated=JSON.parse(await page.evaluate(()=>localStorage.getItem('led-wall-layout-v1')));
  assert.equal(migrated.config.alignment,'center');
  assert.equal(migrated.config.zones.some(z=>'alignment' in z),false);
  check('V1.1 session migrates the first zone position to one whole-layout alignment');

  await page.evaluate(()=>{
    const legacy=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    delete legacy.config.alignment;
    legacy.config.zones.forEach(z=>delete z.alignment);
    legacy.panels.forEach(p=>{delete p.typical_power_w;delete p.max_power_w;});
    localStorage.setItem('led-wall-layout-v1',JSON.stringify(legacy));
  });
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await alignment().inputValue(),'bottom_left');
  current=await snapshot();
  assert.equal(current.power.typical.status,'unknown');
  assert.match(await page.locator('#results').textContent(),/Unknown/);
  await page.locator('#manage-library').click();
  await page.getByRole('button',{name:'Edit Demo Wide 600',exact:true}).click();
  assert.equal(await form.locator('[name="typical_power_w"]').inputValue(),'');
  await page.locator('#close-library').click();
  await page.evaluate(saved=>localStorage.setItem('led-wall-layout-v1',saved),savedWithPower);
  await page.reload();await page.waitForSelector('#diagram svg');
  check('legacy sessions retain bottom-left layout and missing power stays unknown');

  const poweredReport=await page.evaluate(async()=>{
    const {calculate}=await import('./core.js');const {renderDiagram,summaryText}=await import('./diagram.js');
    const saved=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    const result=calculate(saved.config,saved.panels);
    return {svg:renderDiagram(result,{report:true}),summary:summaryText(result)};
  });
  for(const text of [poweredReport.svg,poweredReport.summary]) {
    assert.match(text,/alignment/i);
    assert.match(text,/Left/);assert.match(text,/Right/);assert.match(text,/Top/);assert.match(text,/Bottom/);
    assert.match(text,/3,200 W/);assert.match(text,/3.2 kW/);assert.match(text,/6,400 W/);assert.match(text,/6.4 kW/);
  }
  const poweredPngEvent=page.waitForEvent('download');
  await page.locator('#export-png').click();
  await (await poweredPngEvent).saveAs(resolve(root,'qa/power-report.png'));
  const poweredPng=await readFile(resolve(root,'qa/power-report.png'));
  assert.equal(poweredPng.readUInt32BE(16),1800);
  assert.ok(poweredPng.length>40000);
  await page.screenshot({path:resolve(root,'qa/alignment-power.png'),fullPage:true});
  check('PNG and summary include whole-layout alignment, four wall gaps and W/kW power totals');

  // Restore the original nonexact split before existing error-path checks.
  await page.locator('#split-offset').fill('2500');

  await page.locator('#fit-strategy').selectOption('exact_only');
  assert.equal(await page.locator('#error').isVisible(),true);
  assert.match(await page.locator('#error').textContent(),/Fit inside:.*cover wall:/);
  await page.locator('#fit-strategy').selectOption('fit_inside');
  await page.locator('#split-direction').selectOption('horizontal');
  await page.locator('#split-offset').fill('1350');
  assert.match(await page.locator('#results').textContent(),/Bottom zone/);
  await page.locator('#split-offset').fill('2700');
  assert.equal(await page.locator('#error').isVisible(),true);
  await page.locator('#split-offset').fill('1350');
  await page.getByLabel('Single panel',{exact:true}).check();
  await page.locator('#wall-width').fill('10');
  assert.match(await page.locator('.metric').first().textContent(),/0/);
  assert.match(await page.locator('#results').textContent(),/0 × 0 px/);
  assert.equal(await page.locator('#results').textContent().then(s=>/NaN|Infinity/.test(s)),false);
  await page.locator('#wall-width').fill('4800');
  check('exact error suggestions, horizontal split validation, zero-fit no fake canvas');

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(root,'qa/mobile.png'),fullPage:true});
  await page.locator('#manage-library').click();
  assert.equal(await page.evaluate(()=>document.getElementById('library-dialog').scrollWidth<=document.getElementById('library-dialog').clientWidth),true);
  await page.screenshot({path:resolve(root,'qa/mobile-library.png'),fullPage:true});
  await page.locator('#close-library').click();
  check('390px mobile stacked layout and usable panel library');

  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();await page.waitForSelector('#diagram svg');
  await context.setOffline(true);
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.match(await page.locator('#results').textContent(),/64/);
  await page.locator('#wall-width').fill('4200');
  assert.equal(await page.locator('.metric .value').first().textContent(),'56');
  check('offline reload and live calculations after first load');
  assert.deepEqual(errors,[]);
  check('no browser JavaScript errors');
  console.log(`\n${checks.length} browser checks passed. Screenshots/downloads: qa/`);
} finally {await browser.close();server.close();}
