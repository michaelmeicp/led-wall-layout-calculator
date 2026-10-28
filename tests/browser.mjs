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
try {
  await page.goto(url);
  await page.waitForSelector('#diagram svg');
  assert.equal(await page.locator('.metric .value').first().textContent(),'64');
  assert.equal(await page.locator('#error').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(root,'qa/desktop.png'),fullPage:true});
  check('desktop default decimal cabinet grid and layout');

  await page.getByLabel('Two zones',{exact:true}).check();
  await page.waitForSelector('.zone-result:nth-child(2)');
  assert.match(await page.locator('#results').textContent(),/3,072 × 1,728/);
  assert.match(await page.locator('#results').textContent(),/104/);
  assert.match(await page.locator('.mapping').textContent(),/Aligned pixel canvas/);
  await page.screenshot({path:resolve(root,'qa/two-zones.png'),fullPage:true});
  check('two-zone mixed 600 × 337.5 / 300 × 300 aligned canvas');

  await page.locator('#split-offset').fill('2500');
  await page.locator('#fit-strategy').selectOption('cover_wall');
  assert.match(await page.locator('.warnings').textContent(),/overlaps/);
  assert.match(await page.locator('.mapping').textContent(),/Processor mapping/);
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
  for(const word of ['Left zone','Right zone','overlaps','LAYOUT WARNINGS','Counts by SKU'])assert.ok(report.includes(word));
  check('cover overflow warns against clean canvas; full two-zone PNG downloads');

  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('#copy-summary').click();
  const clipboard=await page.evaluate(()=>navigator.clipboard.readText());
  for(const word of ['Target:','from LEFT','Left zone','Right zone','Grid:','Per-zone resolution:','Actual frame footprint:','overflow','overlaps'])assert.ok(clipboard.includes(word));
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
