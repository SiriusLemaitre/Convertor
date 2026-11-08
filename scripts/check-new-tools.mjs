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
  for(const [name,value] of [['Left (px)','11'],['Top (px)','21'],['Width (px)','101'],['Height (px)','81']]) await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  await page.getByRole('button',{name:'Preview frame',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.rendered-preview')?.naturalWidth===100 && document.querySelector('.rendered-preview')?.naturalHeight===80);
  const rect=inspect(await run()); assert.equal(rect.streams[0].width,100); assert.equal(rect.streams[0].height,80);
  await nav('Crop video');
  await page.screenshot({path:path.join(folder,'crop.png'),fullPage:true});
  await page.getByRole('spinbutton',{name:'Left (px)',exact:true}).fill('300'); await run('failed');
  assert.deepEqual(errors,[]);
  console.log(`Passed ${native?'desktop':'browser'} PDF-to-Markdown, scan error, ratio crop, custom crop, preview, audio, duration, and bounds checks.`);
} finally { await browser?.close(); app?.kill(); }
