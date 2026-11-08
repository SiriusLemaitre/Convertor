import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const native = process.argv.includes('--desktop');
const folder = path.resolve('.tools', native ? 'new-tools-desktop' : 'new-tools-browser');
mkdirSync(folder,{recursive:true});
const engine = name => path.resolve('src-tauri/binaries',`${name}.exe`);
const image = path.join(folder,'source.png');
execFileSync(engine('ffmpeg'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x240','-frames:v','1',image],{windowsHide:true});
const video = path.join(folder,'source.mp4'), pdfPath = path.join(folder,'text.pdf'), blankPath = path.join(folder,'scan.pdf');
execFileSync(engine('ffmpeg'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=10','-f','lavfi','-i','sine=frequency=440','-t','1','-c:v','libx264','-c:a','aac',video],{windowsHide:true});
const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText('Hello *literal* cafe',{font,x:30,y:700,size:14});
pdf.addPage().drawText('Second page',{font,x:30,y:700,size:14});
writeFileSync(pdfPath,await pdf.save());
const blank = await PDFDocument.create(); blank.addPage(); writeFileSync(blankPath,await blank.save());
const port = 12000 + process.pid % 20000;
let app, browser;
const errors=[];
try {
  if (native) {
    app = spawn(path.resolve(process.env.CONVERTOR_APP || 'release/Convertor.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,WEBVIEW2_USER_DATA_FOLDER:path.join(folder,`profile-${Date.now()}`)}});
    for(let n=0;n<60;n++) { try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break; } catch { await new Promise(r=>setTimeout(r,500)); } }
    assert.ok(browser,'Desktop app failed to start');
  } else browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',headless:true});
  const page = native ? browser.contexts()[0].pages()[0] : await browser.newPage({viewport:{width:1320,height:950},acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  if(native) { await page.waitForLoadState(); await page.evaluate(()=>localStorage.clear()); await page.reload(); }
  else await page.goto(process.env.SITE_URL || 'http://127.0.0.1:4173',{waitUntil:'networkidle'});
  const nav = async name => { await page.locator('.sidebar').getByRole('button',{name,exact:true}).click(); await page.getByRole('heading',{name,exact:true}).waitFor(); };
  const add = async file => {
    if(native) await page.evaluate(paths=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'tauri://drag-drop',payload:{paths,position:{x:400,y:300}}}),[file]);
    else { const chooser=page.waitForEvent('filechooser'); await page.locator('.dropzone').click(); await (await chooser).setFiles(file); }
    await page.locator('.file-row').first().waitFor();
  };
  async function run(expected='completed') {
    await page.locator('.convert-button').click();
    await page.waitForFunction(()=>['completed','failed'].some(s=>document.querySelector('.job-row .job-status')?.classList.contains(s)),undefined,{timeout:180000});
    const row=page.locator('.job-row').first();
    assert.equal(await row.locator('.job-status').textContent(),expected,await row.textContent());
    if(expected==='failed') return row;
    if(native) return (await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('list_jobs')))[0].output;
    const download=page.waitForEvent('download'); await row.getByRole('button',{name:/^Download /}).click(); const result=await download;
    const target=path.join(folder,result.suggestedFilename()); await result.saveAs(target); return target;
  }
  await nav('PDF to Markdown'); await add(pdfPath);
  const md=readFileSync(await run(),'utf8');
  assert.match(md,/## Page 1/); assert.ok(md.includes('Hello \\*literal\\* cafe')); assert.match(md,/## Page 2[\s\S]*Second page/);
  await nav('PDF to Markdown');
  await page.screenshot({path:path.join(folder,'markdown.png'),fullPage:true});
  await page.getByRole('button',{name:'Clear list',exact:true}).click(); await add(blankPath);
  const failed=await run('failed'); assert.match(await failed.textContent(),/OCR/);
  await nav('Crop video'); await add(video);
  await page.getByRole('button',{name:'Preview frame',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.rendered-preview')?.naturalWidth===240);
  const square=await run();
  const inspect=file=>JSON.parse(execFileSync(engine('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',windowsHide:true}));
  const sq=inspect(square); assert.equal(sq.streams[0].width,240); assert.equal(sq.streams[0].height,240); assert.ok(sq.streams.some(s=>s.codec_type==='audio')); assert.ok(Math.abs(Number(sq.format.duration)-1)<.2);
  await nav('Crop video');
  await page.getByRole('combobox',{name:'Crop area',exact:true}).selectOption('custom');
  await page.getByText('Enter pixel coordinates',{exact:true}).click();
  for(const [name,value] of [['Left (px)','11'],['Top (px)','21'],['Width (px)','101'],['Height (px)','81']]) await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  await page.getByRole('button',{name:'Preview frame',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.rendered-preview')?.naturalWidth===100 && document.querySelector('.rendered-preview')?.naturalHeight===80);
  const rect=inspect(await run()); assert.equal(rect.streams[0].width,100); assert.equal(rect.streams[0].height,80);
  await nav('Crop video');
  await page.screenshot({path:path.join(folder,'crop.png'),fullPage:true});
  await page.getByText('Enter pixel coordinates',{exact:true}).click();
  await page.getByRole('spinbutton',{name:'Left (px)',exact:true}).fill('300'); await run('failed');
  async function visualCrop(tool, source) {
    await nav(tool);
    if(source) await add(source);
    await page.getByRole('button',{name:'Use full frame',exact:true}).click();
    const stage=page.locator('.crop-stage'); await stage.scrollIntoViewIfNeeded();
    const bounds=await stage.boundingBox();
    const handle=await page.getByRole('button',{name:'Resize crop top left',exact:true}).boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2); await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2+bounds.width*.25,handle.y+handle.height/2+bounds.height*.25,{steps:8}); await page.mouse.up();
    const key=tool==='Crop video'?'video-crop':'image-edit';
    const getRect=()=>page.evaluate(key=>JSON.parse(localStorage.getItem('convertor.options.v1.'+key)).cropRect,key);
    let crop=await getRect(); assert.ok(Math.abs(crop.x-.25)<.01); assert.ok(Math.abs(crop.width-.75)<.01);
    // Move the selection, including to the source boundary, using keyboard and pointer.
    const box=page.getByRole('group',{name:'Crop selection',exact:true}); await box.focus(); await box.press('Shift+ArrowLeft');
    crop=await getRect(); assert.ok(crop.x<.25);
    const selected=await box.boundingBox();
    await page.mouse.move(selected.x+selected.width*.4,selected.y+selected.height*.4); await page.mouse.down();
    await page.mouse.move(bounds.x-100,bounds.y-100,{steps:5}); await page.mouse.up();
    crop=await getRect(); assert.equal(crop.x,0); assert.equal(crop.y,0);
    const edge=page.getByRole('button',{name:'Resize crop right',exact:true}); await edge.focus(); await edge.press('Shift+ArrowLeft');
    crop=await getRect(); assert.ok(crop.width<.75);
    if(!native) {
      await page.setViewportSize({width:1000,height:800});
      assert.deepEqual(await getRect(),crop,'Resizing the window must preserve source coordinates');
      await page.setViewportSize({width:1320,height:950});
    }
    await page.screenshot({path:path.join(folder,key+'-visual.png'),fullPage:true});
    const output=await run(); const data=inspect(output); const stream=data.streams.find(s=>s.codec_type==='video');
    const w=320,h=240;
    assert.equal(stream.width,tool==='Crop video'?Math.max(2,Math.trunc(w*crop.width/2)*2):Math.round(w*crop.width));
    assert.equal(stream.height,tool==='Crop video'?Math.max(2,Math.trunc(h*crop.height/2)*2):Math.round(h*crop.height));
    if(tool!=='Crop video') {
      const expected=path.join(folder,'expected.png');
      execFileSync(engine('ffmpeg'),['-y','-v','error','-i',image,'-vf',`crop=${stream.width}:${stream.height}:0:0:exact=1`,expected],{windowsHide:true});
      const pixels=file=>execFileSync(engine('ffmpeg'),['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true});
      const actual=pixels(output), reference=pixels(expected); assert.equal(actual.length,reference.length);
      const maxDifference=actual.reduce((max,value,i)=>Math.max(max,Math.abs(value-reference[i])),0);
      assert.ok(maxDifference <= (native?0:2), 'Crop pixels must match the selected source area (allowing browser color rounding).');
    }
    await nav(tool); await page.getByRole('button',{name:'Use full frame',exact:true}).click();
    const reset = await getRect(); assert.deepEqual(reset,{x:0,y:0,width:1,height:1});
  }
  await visualCrop('Crop video');
  await visualCrop('Resize, crop & rotate',image);
  await page.getByRole('combobox',{name:'Rotate clockwise',exact:true}).selectOption('90');
  await page.getByRole('button',{name:'Use full frame',exact:true}).click();
  await page.getByRole('button',{name:'Resize crop top',exact:true}).focus();
  await page.getByRole('button',{name:'Resize crop top',exact:true}).press('Shift+ArrowDown');
  const rotated=inspect(await run()).streams[0]; assert.equal(rotated.width,240); assert.equal(rotated.height,310);
  assert.deepEqual(errors,[]);
  console.log(`Passed ${native?'desktop':'browser'} PDF export, video/image visual crops, mouse/keyboard resizing, window resize, image rotation, source pixels, audio, duration, preview and bounds checks.`);
} finally { await browser?.close(); app?.kill(); }
