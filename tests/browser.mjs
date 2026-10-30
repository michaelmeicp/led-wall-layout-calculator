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
const alignments=['top_left','top_center','top_right','middle_left','center','middle_right','bottom_left','bottom_center','bottom_right'];
const lockButton=()=>page.locator('#composition-lock');
const savedSession=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('led-wall-layout-v1')));
function assertGroupPlacement(result,value) {
  const {group,wall}=result;
  const dx=wall.width_mm-group.width,dy=wall.height_mm-group.height;
  const [vertical,horizontal]=value==='center'?['middle','center']:value.split('_');
  const left=horizontal==='center'?dx/2:horizontal==='right'?dx:0;
  const bottom=vertical==='middle'?dy/2:vertical==='top'?dy:0;
  assert.equal(group.alignment,value);
  assert.equal(group.x,left);assert.equal(group.y,bottom);
  assert.deepEqual(group.gaps,{left,right:dx-left,top:dy-bottom,bottom});
}
const countInput=(zone,field)=>page.locator(`[data-zone="${zone}"][data-field="${field}"]`);
const diagramReadback=()=>page.evaluate(async()=>{
  const {calculate}=await import('./core.js');
  const saved=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
  const result=calculate({...saved.config,zones:saved.config.zones.slice(0,saved.config.mode==='single'?1:2)},saved.panels);
  const svg=document.querySelector('#diagram svg');
  const rectBox=rect=>Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(rect.getAttribute(key))]));
  const view=svg.viewBox.baseVal;
  const labels=[...svg.querySelectorAll('[data-gap-label]')].map(label=>{
    const b=label.getBBox(),m=svg.getCTM().inverse().multiply(label.getCTM());
    const points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
    const edge=label.getAttribute('data-gap-label'),box=svg.querySelector(`rect[data-gap-box="${edge}"]`);
    const bounds=box?rectBox(box):null;
    return {edge,text:label.textContent,inside:points.every(p=>p.x>=view.x-1&&p.y>=view.y-1&&p.x<=view.x+view.width+1&&p.y<=view.y+view.height+1),insideBox:bounds&&points.every(p=>p.x>=bounds.x-1&&p.y>=bounds.y-1&&p.x<=bounds.x+bounds.width+1&&p.y<=bounds.y+bounds.height+1)};
  });
  return {result,wall:rectBox(svg.querySelector('rect[data-wall]')||svg.querySelector('rect[stroke="#182b3a"][stroke-width="2.6"]')),group:rectBox(svg.querySelector('[data-group="assembly"]')),gaps:[...svg.querySelectorAll('line[data-gap-edge]')].map(line=>({edge:line.dataset.gapEdge,mm:Number(line.dataset.gapMm),...Object.fromEntries(['x1','y1','x2','y2'].map(key=>[key,Number(line.getAttribute(key))]))})),labels};
});
function assertDrawnGaps(readback) {
  const {result,wall,group,gaps,labels}=readback;
  assert.deepEqual(gaps.map(g=>g.edge).sort(),['bottom','left','right','top']);
  assert.deepEqual(labels.map(g=>g.edge).sort(),['bottom','left','right','top']);
  const scale=wall.width/result.wall.width_mm;
  const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<0.005,`${label}: ${actual} vs ${expected}`);
  for(const gap of gaps) {
    const mm=result.group.gaps[gap.edge];assert.equal(gap.mm,mm);
    const horizontal=gap.edge==='left'||gap.edge==='right';
    const drawn=[horizontal?gap.x1:gap.y1,horizontal?gap.x2:gap.y2].sort((a,b)=>a-b);
    const expected={left:[wall.x,group.x],right:[group.x+group.width,wall.x+wall.width],top:[wall.y,group.y],bottom:[group.y+group.height,wall.y+wall.height]}[gap.edge].sort((a,b)=>a-b);
    near(drawn[0],expected[0],`${gap.edge} bracket starts on actual wall/frame edge`);
    near(drawn[1],expected[1],`${gap.edge} bracket ends on actual wall/frame edge`);
    near(Math.hypot(gap.x2-gap.x1,gap.y2-gap.y1),Math.abs(mm)*scale,`${gap.edge} bracket represents actual mm`);
    const label=labels.find(l=>l.edge===gap.edge);
    const number=Number(Math.abs(mm).toPrecision(10)).toLocaleString('en-US',{maximumFractionDigits:6});
    assert.ok(label.text.toLowerCase().includes(`${mm<0?'overflow':'gap'} ${number} mm`),label.text);
    assert.equal(label.inside,true,`${gap.edge} dimension label is not clipped`);
    assert.equal(label.insideBox,true,`${gap.edge} dimension label fits its reserved box`);
  }
}
try {
  await page.goto(url);
  await page.waitForSelector('#diagram svg');
  assert.equal(await page.locator('#sizing-mode').inputValue(),'manual');
  assert.equal(await page.locator('input[name="mode"][value="two_zones"]').isChecked(),true);
  assert.equal(await page.locator('#wall-width').inputValue(),'8000');
  assert.equal(await page.locator('#wall-height').inputValue(),'3000');
  for(const [zone,columns,rows] of [[0,'4','4'],[1,'6','4']]) {
    assert.equal(await countInput(zone,'columns').inputValue(),columns);
    assert.equal(await countInput(zone,'rows').inputValue(),rows);
  }
  assert.equal(await page.locator('#split-controls').isVisible(),false);
  let manual=await snapshot();
  assert.equal(manual.sizingMode,'manual');assert.equal(manual.totalCount,40);
  assert.deepEqual(manual.zones.map(z=>[z.actualWidth,z.actualHeight]),[[2400,1350],[1800,1200]]);
  assert.deepEqual(manual.group.gaps,{left:1900,right:1900,top:825,bottom:825});
  assert.equal(manual.zones[0].actualX+2400,manual.zones[1].actualX);
  assertDrawnGaps(await diagramReadback());
  await page.waitForTimeout(250);
  await page.screenshot({path:resolve(root,'qa/manual-default-centered.png'),fullPage:true,animations:'disabled'});
  check('fresh manual A+B example joins 40 cabinets inside a larger wall with visible 1,900 / 825 mm gap brackets');

  await page.locator('#wall-width').fill('10000');await page.locator('#wall-height').fill('4000');
  manual=await snapshot();assert.equal(manual.totalCount,40);
  assert.deepEqual([manual.group.width,manual.group.height],[4200,1350]);
  assert.deepEqual(manual.group.gaps,{left:2900,right:2900,top:1325,bottom:1325});
  await countInput(0,'columns').fill('0');assert.equal(await page.locator('#error').isVisible(),true);
  assert.match(await page.locator('#error').textContent(),/columns/i);await countInput(0,'columns').fill('4');
  await countInput(1,'rows').fill('2.5');assert.equal(await page.locator('#error').isVisible(),true);
  await countInput(1,'rows').fill('4');
  await page.locator('#wall-width').fill('8000');await page.locator('#wall-height').fill('3000');
  for(const [arrangement,size] of [['side_by_side',[4200,1350]],['stacked',[2400,2550]]]) {
    await page.locator('#arrangement').selectOption(arrangement);
    for(const anchor of alignments) {
      await alignment().selectOption(anchor);manual=await snapshot();assertGroupPlacement(manual,anchor);
      assert.deepEqual([manual.group.width,manual.group.height],size);
      const [a,b]=manual.zones;
      if(arrangement==='side_by_side'){assert.equal(a.actualX+a.actualWidth,b.actualX);assert.equal(a.actualY,b.actualY);}
      else {assert.equal(a.actualY+a.actualHeight,b.actualY);assert.equal(a.actualX,b.actualX);}
      assertDrawnGaps(await diagramReadback());
    }
  }
  await page.locator('#arrangement').selectOption('side_by_side');await alignment().selectOption('center');
  await lockButton().click();
  assert.equal(await page.locator('#sizing-mode,#arrangement,[data-field="columns"],[data-field="rows"],#load-example').evaluateAll(inputs=>inputs.every(input=>input.disabled)),true);
  const lockedManual=await savedSession();
  await page.evaluate(()=>{
    for(const [selector,value,event] of [['#sizing-mode','auto_fit','change'],['#arrangement','stacked','change'],['[data-zone="0"][data-field="columns"]','8','input'],['[data-zone="1"][data-field="rows"]','9','input']]) {
      const input=document.querySelector(selector);input.value=value;input.dispatchEvent(new Event(event,{bubbles:true}));
    }
    document.getElementById('load-example').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  });
  assert.deepEqual(await savedSession(),lockedManual,'manual counts, sizing mode, arrangement and example are guarded while locked');
  for(const anchor of alignments) {
    await page.locator(`[data-anchor="${anchor}"]`).click();manual=await snapshot();assertGroupPlacement(manual,anchor);
    assert.equal(manual.totalCount,40);assert.deepEqual([manual.group.width,manual.group.height],[4200,1350]);
    assertDrawnGaps(await diagramReadback());
  }
  await alignment().selectOption('center');await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await page.locator('#sizing-mode').inputValue(),'manual');assert.equal(await lockButton().getAttribute('aria-pressed'),'true');
  assert.equal((await snapshot()).totalCount,40);assertDrawnGaps(await diagramReadback());
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#copy-summary').click();
  const manualSummary=await page.evaluate(()=>navigator.clipboard.readText());
  for(const number of ['4,200','1,350','1,900','825'])assert.ok(manualSummary.includes(number),number);
  assert.match(manualSummary,/manual|cabinet counts/i);
  const manualPngEvent=page.waitForEvent('download');await page.locator('#export-png').click();
  await (await manualPngEvent).saveAs(resolve(root,'qa/manual-centered-report.png'));
  const manualPng=await readFile(resolve(root,'qa/manual-centered-report.png'));assert.equal(manualPng.readUInt32BE(16),1800);assert.ok(manualPng.length>40000);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#composition-lock').scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  await page.screenshot({path:resolve(root,'qa/manual-mobile-controls.png'),animations:'disabled'});
  await page.locator('#diagram').scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  await page.screenshot({path:resolve(root,'qa/manual-mobile-diagram.png'),animations:'disabled'});
  await page.setViewportSize({width:1440,height:1100});
  const wallBeforeConverter=await savedSession();
  await page.locator('#pixel-converter-tab').click();
  assert.equal(await page.locator('#pixel-converter-tab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#conversion-worksheet').isVisible(),true);
  assert.equal(await page.locator('#wall-worksheet').isVisible(),false);
  await page.locator('#conversion-example-p15').click();
  assert.equal(await page.locator('#conversion-mode').inputValue(),'pixels_to_size');
  assert.match(await page.locator('#conversion-results').textContent(),/2,880 × 1,620 mm/);
  await page.locator('#conversion-pitch-mm').fill('');
  assert.equal(await page.locator('#conversion-error').isVisible(),true);
  assert.equal(await page.locator('#conversion-results').isVisible(),false);
  await page.locator('#conversion-pitch-mm').fill('1.5');
  await page.locator('#conversion-pixels-w').fill('1920.5');
  assert.equal(await page.locator('#conversion-error').isVisible(),true);
  await page.locator('#conversion-pixels-w').fill('1920');
  await page.locator('#conversion-example-fractional').click();
  assert.match(await page.locator('#conversion-theoretical-result').textContent(),/2,000 × 1,133\.333/);
  assert.match(await page.locator('#conversion-integer-suggestion').textContent(),/2,000 × 1,133 px/);
  assert.match(await page.locator('#conversion-results').textContent(),/3,000 × 1,699.5 mm/);
  assert.match(await page.locator('#conversion-results').textContent(),/Height drift−0.5 mm/);
  await page.locator('#conversion-mode').selectOption('infer_pitch');
  await page.locator('#conversion-pixels-w').fill('2000');await page.locator('#conversion-pixels-h').fill('1000');
  assert.equal(await page.locator('#conversion-pitch-warning').getAttribute('data-consistent'),'false');
  assert.match(await page.locator('#conversion-pitch-result').textContent(),/X 1.5 mmY 1.7 mm/);
  assert.match(await page.locator('#conversion-pitch-warning').textContent(),/more than 1%/);
  await page.locator('#conversion-height-mm').fill('1500');
  assert.equal(await page.locator('#conversion-pitch-warning').getAttribute('data-consistent'),'true');
  await page.locator('#conversion-height-mm').fill('1700');
  const converterSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('led-pixel-converter-v1')));
  assert.deepEqual(await savedSession(),wallBeforeConverter,'the converter never changes the locked layout or panel library');
  await page.locator('#wall-layout-tab').click();
  assert.equal(await page.locator('#conversion-worksheet').isVisible(),false);
  assert.equal((await snapshot()).totalCount,40);assert.equal(await lockButton().getAttribute('aria-pressed'),'true');
  await page.locator('#pixel-converter-tab').click();
  assert.equal(await page.locator('#conversion-height-mm').inputValue(),'1700');
  await page.reload();await page.locator('#pixel-converter-tab').click();
  assert.equal(await page.locator('#conversion-mode').inputValue(),'infer_pitch');
  assert.equal(await page.locator('#conversion-pitch-warning').getAttribute('data-consistent'),'false');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('led-pixel-converter-v1'))),converterSaved);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#conversion-input-title').scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  await page.screenshot({path:resolve(root,'qa/conversion-mobile-inputs.png'),animations:'disabled'});
  await page.locator('#conversion-results').scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  await page.screenshot({path:resolve(root,'qa/conversion-mobile-results.png'),animations:'disabled'});
  await page.setViewportSize({width:1440,height:1100});await page.locator('#wall-layout-tab').click();
  assert.deepEqual(await savedSession(),wallBeforeConverter);
  assertDrawnGaps(await diagramReadback());
  check('separate pixel worksheet validates P1.5 inverse/fractional/pitch calculations and preserves its state without changing the locked wall');
  await lockButton().click();
  check('manual sizes stay independent of wall size; both arrangements, nine locked anchors, persistence and exported gaps work');

  for(const [width,height] of [[3000,1000],[3000,3000],[8000,1000]]) {
    await page.locator('#wall-width').fill(String(width));await page.locator('#wall-height').fill(String(height));
    for(const anchor of alignments) {
      await alignment().selectOption(anchor);manual=await snapshot();assertGroupPlacement(manual,anchor);
      assert.equal(manual.totalCount,40);assertDrawnGaps(await diagramReadback());
    }
    await alignment().selectOption('center');
    await page.waitForTimeout(250);await page.screenshot({path:resolve(root,`qa/manual-overflow-${width}-${height}.png`),fullPage:true,animations:'disabled'});
  }
  await page.locator('#wall-width').fill('3000');await page.locator('#wall-height').fill('1000');await alignment().selectOption('top_right');
  manual=await snapshot();assert.deepEqual(manual.group.gaps,{left:-1200,right:0,top:0,bottom:-350});
  await page.locator('#copy-summary').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/overflow 1,200 mm/);
  const overflowPngEvent=page.waitForEvent('download');await page.locator('#export-png').click();
  await (await overflowPngEvent).saveAs(resolve(root,'qa/manual-overflow-report.png'));
  assert.equal((await readFile(resolve(root,'qa/manual-overflow-report.png'))).readUInt32BE(16),1800);
  check('oversized manual groups label every signed mm edge without clipping at all nine asymmetric and mixed-axis positions');

  await page.locator('#manage-library').click();
  const customLibrary=await page.evaluate(()=>{
    const stored=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    return {version:1,panels:[{...stored.panels[0],id:crypto.randomUUID(),name:'Keep my library panel'}]};
  });
  await page.locator('#import-file').setInputFiles({name:'keep-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(customLibrary))});
  await page.waitForFunction(()=>document.getElementById('library-status').textContent.includes('Imported'));
  await page.locator('#close-library').click();
  const libraryBeforeExample=(await savedSession()).panels;
  const designBeforeShortcut=await snapshot();
  await lockButton().click();
  assert.equal(await page.locator('#load-example').isDisabled(),true);
  assert.equal(await page.locator('#unlock-from-example').isVisible(),true);
  await page.locator('#unlock-from-example').click();
  assert.deepEqual(await snapshot(),designBeforeShortcut,'the example banner unlock shortcut preserves the existing design');
  await page.locator('#load-example').click();manual=await snapshot();
  assert.deepEqual((await savedSession()).panels,libraryBeforeExample,'example never resets the user library');
  assert.equal(manual.totalCount,40);assert.equal(manual.wall.width_mm,8000);assert.equal(manual.wall.height_mm,3000);
  assert.deepEqual(manual.group.gaps,{left:1900,right:1900,top:825,bottom:825});
  check('load example restores the smaller centered A+B design while preserving an imported user panel');

  // Preserve the original auto-fit regressions as an explicitly selected workflow.
  await page.locator('#sizing-mode').selectOption('auto_fit');
  await page.locator('#wall-width').fill('4800');await page.locator('#wall-height').fill('2700');
  await page.locator('#split-direction').selectOption('vertical');await page.locator('#split-offset').fill('2400');
  await page.locator('input[name="mode"][value="single"]').check();
  assert.equal(await page.locator('.metric .value').first().textContent(),'64');
  assert.equal(await page.locator('#error').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(root,'qa/desktop.png'),fullPage:true});
  check('desktop default decimal cabinet grid and layout');

  assert.equal(await alignment().inputValue(),'center');
  assert.deepEqual((await alignment().locator('option').evaluateAll(options=>options.map(o=>o.value))).sort(),[...alignments].sort());
  assert.equal(await lockButton().getAttribute('aria-pressed'),'false');
  assert.equal((await snapshot()).compositionLocked,false);
  assert.equal(await page.locator('[data-zone][data-field="alignment"]').count(),0);
  await page.locator('#wall-width').fill('2500');
  await page.locator('#wall-height').fill('1500');
  for(const [value,expected] of [
    ['center',{left:50,right:50,top:75,bottom:75}],
    ['top_left',{left:0,right:100,top:0,bottom:150}],
    ['top_center',{left:50,right:50,top:0,bottom:150}],
    ['top_right',{left:100,right:0,top:0,bottom:150}],
    ['middle_left',{left:0,right:100,top:75,bottom:75}],
    ['middle_right',{left:100,right:0,top:75,bottom:75}],
    ['bottom_left',{left:0,right:100,top:150,bottom:0}],
    ['bottom_center',{left:50,right:50,top:150,bottom:0}],
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
    for(const edge of ['Left','Right','Top','Bottom'])assert.match(drawing,new RegExp(edge,'i'));
  }
  await alignment().selectOption('center');
  await page.locator('#fit-strategy').selectOption('cover_wall');
  let current=await snapshot();
  assert.deepEqual(current.group.gaps,{left:-250,right:-250,top:-93.75,bottom:-93.75});
  assert.match(await page.locator('#results').textContent(),/overflow 250 mm/);
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
  check('all nine anchors show signed frame gaps, overflow and rotated offsets');

  await page.locator('input[name="mode"][value="two_zones"]').check();
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
  check('unequal vertical, horizontal and rotated grids stay joined at all nine whole-group positions');

  // Set the A/B sizes first, lock them, then move only the complete composition.
  const unlocked=await snapshot();
  await page.locator('#manage-library').click();
  const delayedImport=await page.evaluate(()=>{
    const stored=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    const panel={...stored.panels[0],id:crypto.randomUUID(),name:'Delayed import blocked by lock'};
    window.delayedImportJSON=JSON.stringify({version:1,panels:[panel]});
    const originalText=File.prototype.text;
    window.restoreImportText=()=>{File.prototype.text=originalText;};
    File.prototype.text=function(){
      if(this.name!=='delayed-import.json')return originalText.call(this);
      return new Promise(resolve=>{window.releaseDelayedImport=()=>resolve(window.delayedImportJSON);});
    };
    return window.delayedImportJSON;
  });
  await page.locator('#import-file').setInputFiles({name:'delayed-import.json',mimeType:'application/json',buffer:Buffer.from(delayedImport)});
  await page.waitForFunction(()=>typeof window.releaseDelayedImport==='function');
  await page.locator('#close-library').click();
  await lockButton().click();
  assert.equal(await lockButton().getAttribute('aria-pressed'),'true');
  assert.match(await lockButton().textContent(),/Unlock composition/i);
  assert.match(await page.locator('#composition-status').textContent(),/unlock/i);
  assert.equal((await snapshot()).compositionLocked,true);
  const sizeInputs='#wall-width,#wall-height,input[name="mode"],#split-direction,#split-offset,#fit-strategy,[data-zone][data-field="panelId"],[data-zone][data-field="rotated"]';
  assert.equal(await page.locator(sizeInputs).evaluateAll(inputs=>inputs.every(input=>input.disabled)),true);
  for(const id of ['wall-name','layout-alignment','manage-library','copy-summary','export-png'])assert.equal(await page.locator(`#${id}`).isEnabled(),true,id);
  await page.locator('#wall-name').fill('Locked A + B assembly');
  assert.equal((await snapshot()).wall.name,'Locked A + B assembly');
  const frozen=await savedSession();
  await page.evaluate(async()=>{
    window.releaseDelayedImport();window.restoreImportText();
    await new Promise(resolve=>setTimeout(resolve,50));
  });
  assert.deepEqual(await savedSession(),frozen,'an import started unlocked cannot commit after the composition is locked');
  await page.evaluate(()=>{
    const input=(id,value,type)=>{
      const element=document.getElementById(id);element.value=value;
      element.dispatchEvent(new Event(type,{bubbles:true}));
    };
    input('wall-width','9999','input');input('wall-height','9999','input');
    input('split-direction','horizontal','change');input('split-offset','100','input');
    input('fit-strategy','cover_wall','change');
    const mode=document.querySelector('input[name="mode"][value="single"]');
    mode.checked=true;mode.dispatchEvent(new Event('change',{bubbles:true}));
    const panel=document.querySelector('[data-zone="0"][data-field="panelId"]');
    panel.value=panel.options[panel.options.length-1].value;panel.dispatchEvent(new Event('change',{bubbles:true}));
    const rotation=document.querySelector('[data-zone="0"][data-field="rotated"]');
    rotation.value='true';rotation.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.deepEqual(await savedSession(),frozen,'synthetic sizing/model events cannot alter a locked composition');
  await page.locator('#manage-library').click();
  assert.equal(await page.locator('#library-dialog').isVisible(),true);
  for(const id of ['add-panel','import-library','import-file'])assert.equal(await page.locator(`#${id}`).isDisabled(),true,id);
  assert.equal(await page.locator('#panel-form input:not([type="hidden"]),#panel-form textarea,#panel-form button[type="submit"]').evaluateAll(inputs=>inputs.every(input=>input.disabled)),true);
  assert.equal(await page.locator('.library-item button[data-action="duplicate"],.library-item button[data-action="delete"]').evaluateAll(buttons=>buttons.every(button=>button.disabled)),true);
  assert.equal(await page.locator('#export-library').isEnabled(),true);
  const lockedJsonEvent=page.waitForEvent('download');
  await page.locator('#export-library').click();
  await (await lockedJsonEvent).saveAs(resolve(root,'qa/locked-library.json'));
  const lockedLibrary=JSON.parse(await readFile(resolve(root,'qa/locked-library.json'),'utf8'));
  assert.equal(lockedLibrary.panels.length,frozen.panels.length);
  const blockedMutations=await page.evaluate(async()=>{
    const dispatchClick=element=>element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const form=document.getElementById('panel-form');
    form.elements.name.value='Blocked edit';form.elements.active_width_mm.value='100';
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    dispatchClick(document.getElementById('add-panel'));
    dispatchClick(document.querySelector('.library-item button[data-action="duplicate"]'));
    dispatchClick(document.querySelector('.library-item button[data-action="delete"]'));
    dispatchClick(document.getElementById('import-library'));
    const stored=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    const panel={...stored.panels[0],id:crypto.randomUUID(),name:'Blocked import'};
    const file=new File([JSON.stringify({version:1,panels:[panel]})],'locked-import.json',{type:'application/json'});
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=document.getElementById('import-file');input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    // File.text() is asynchronous; allow an unguarded handler to finish before comparison.
    await file.text();await new Promise(resolve=>setTimeout(resolve,50));
    return JSON.parse(localStorage.getItem('led-wall-layout-v1'));
  });
  assert.deepEqual(blockedMutations,frozen,'synthetic submit/button/import events cannot mutate the locked panel library');
  await page.locator('#close-library').click();
  const relativeBefore=unlocked.zones.map(z=>[z.actualX-unlocked.group.x,z.actualY-unlocked.group.y,z.nx,z.ny]);
  for(const value of alignments) {
    const anchor=page.locator(`[data-anchor="${value}"]`);
    if(await anchor.count())await anchor.click();else await alignment().selectOption(value);
    let locked=await snapshot();
    assertGroupPlacement(locked,value);
    assert.equal(locked.compositionLocked,true);
    assert.deepEqual(locked.zones.map(z=>[z.actualX-locked.group.x,z.actualY-locked.group.y,z.nx,z.ny]),relativeBefore,'locked A/B arrangement remains rigid');
    assert.equal((await savedSession()).config.alignment,value);
    await page.reload();await page.waitForSelector('#diagram svg');
    assert.equal(await alignment().inputValue(),value);
    assert.equal(await lockButton().getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#wall-width').isDisabled(),true);
    locked=await snapshot();assertGroupPlacement(locked,value);
    assert.equal(locked.compositionLocked,true);
  }
  await alignment().selectOption('bottom_center');
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('#copy-summary').click();
  const lockedSummary=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(lockedSummary,/Locked A \+ B assembly/);
  assert.match(lockedSummary,/Composition: Locked/);
  const lockedReport=await page.evaluate(async()=>{
    const {calculate}=await import('./core.js');const {renderDiagram}=await import('./diagram.js');
    const saved=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    return renderDiagram(calculate(saved.config,saved.panels),{report:true});
  });
  assert.match(lockedReport,/Composition: Locked/);
  const lockedPngEvent=page.waitForEvent('download');
  await page.locator('#export-png').click();
  await (await lockedPngEvent).saveAs(resolve(root,'qa/locked-composition.png'));
  const lockedPng=await readFile(resolve(root,'qa/locked-composition.png'));
  assert.equal(lockedPng.readUInt32BE(16),1800);
  await page.screenshot({path:resolve(root,'qa/locked-composition-ui.png'),fullPage:true});
  await lockButton().click();
  assert.equal(await lockButton().getAttribute('aria-pressed'),'false');
  assert.match(await lockButton().textContent(),/Lock composition/i);
  assert.equal((await snapshot()).compositionLocked,false);
  assert.equal(await page.locator(sizeInputs).evaluateAll(inputs=>inputs.every(input=>!input.disabled)),true);
  await page.locator('#wall-width').fill('3000');
  assert.equal((await snapshot()).wall.width_mm,3000);
  await page.locator('#manage-library').click();
  for(const id of ['add-panel','import-library'])assert.equal(await page.locator(`#${id}`).isEnabled(),true,id);
  assert.equal(await page.locator('#panel-form [name="name"]').isEnabled(),true);
  assert.equal(await page.locator('#panel-form button[type="submit"]').isEnabled(),true);
  await page.locator('#close-library').click();
  await page.locator('#wall-name').fill('Main stage');
  await alignment().selectOption('center');
  await page.locator('#wall-width').fill('4800');
  await page.locator('#wall-height').fill('2700');
  await page.locator('#split-direction').selectOption('vertical');
  check('lock preserves combined A/B sizes and library against direct events; all nine locations, reloads and exports remain available');

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
  await page.locator('input[name="mode"][value="single"]').check();
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
  await page.locator('input[name="mode"][value="two_zones"]').check();
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
    delete previous.config.sizingMode;
    previous.config.zones[0].alignment='center';
    previous.config.zones[1].alignment='bottom_right';
    localStorage.setItem('led-wall-layout-v1',JSON.stringify(previous));
  });
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await alignment().inputValue(),'center');
  assert.equal(await page.locator('#sizing-mode').inputValue(),'auto_fit');
  current=await snapshot();
  assertGroupPlacement(current,'center');
  const migrated=JSON.parse(await page.evaluate(()=>localStorage.getItem('led-wall-layout-v1')));
  assert.equal(migrated.config.alignment,'center');
  assert.equal(migrated.config.zones.some(z=>'alignment' in z),false);
  check('V1.1 session migrates the first zone position to one whole-layout alignment');

  await page.evaluate(()=>{
    const legacy=JSON.parse(localStorage.getItem('led-wall-layout-v1'));
    delete legacy.config.alignment;
    delete legacy.config.sizingMode;
    legacy.config.zones.forEach(z=>delete z.alignment);
    legacy.panels.forEach(p=>{delete p.typical_power_w;delete p.max_power_w;});
    localStorage.setItem('led-wall-layout-v1',JSON.stringify(legacy));
  });
  await page.reload();await page.waitForSelector('#diagram svg');
  assert.equal(await alignment().inputValue(),'bottom_left');
  assert.equal(await page.locator('#sizing-mode').inputValue(),'auto_fit');
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
  assert.equal(await lockButton().isDisabled(),true);
  await lockButton().dispatchEvent('click');
  assert.equal((await savedSession()).config.compositionLocked,false);
  assert.match(await page.locator('#error').textContent(),/Fit inside:.*cover wall:/);
  await page.locator('#fit-strategy').selectOption('fit_inside');
  await page.locator('#split-direction').selectOption('horizontal');
  await page.locator('#split-offset').fill('1350');
  assert.match(await page.locator('#results').textContent(),/Bottom zone/);
  await page.locator('#split-offset').fill('2700');
  assert.equal(await page.locator('#error').isVisible(),true);
  await page.locator('#split-offset').fill('1350');
  await page.locator('input[name="mode"][value="single"]').check();
  await page.locator('#wall-width').fill('10');
  assert.match(await page.locator('.metric').first().textContent(),/0/);
  assert.match(await page.locator('#results').textContent(),/0 × 0 px/);
  assert.equal(await lockButton().isDisabled(),true);
  await lockButton().dispatchEvent('click');
  assert.equal((await savedSession()).config.compositionLocked,false);
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
  await page.locator('#pixel-converter-tab').click();await page.locator('#conversion-example-p15').click();
  assert.equal(await page.locator('#conversion-error').isVisible(),false);
  assert.match(await page.locator('#conversion-results').textContent(),/2,880 × 1,620 mm/);
  await page.locator('#wall-layout-tab').click();
  check('offline reload and live calculations in both worksheets after first load');
  assert.deepEqual(errors,[]);
  check('no browser JavaScript errors');
  console.log(`\n${checks.length} browser checks passed. Screenshots/downloads: qa/`);
} finally {await browser.close();server.close();}
