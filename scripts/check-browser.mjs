import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';

// The app under test uses only browser APIs. Native engines generate fixtures
// here and independently inspect downloaded results; no desktop app is launched.
const site = process.env.SITE_URL || 'http://127.0.0.1:4173';
const folder = path.resolve('.tools/browser-only-smoke'); mkdirSync(folder,{recursive:true});
const ffmpeg = path.resolve('src-tauri/binaries/ffmpeg.exe');
const image = path.join(folder,'image café.png'), audio = path.join(folder,'audio.wav'), video = path.join(folder,'video.mp4');
for (const [target,args] of [[image,['-f','lavfi','-i','testsrc2=size=160x120','-frames:v','1']],[audio,['-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1']],[video,['-f','lavfi','-i','testsrc2=size=160x120:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1','-c:v','libx264','-c:a','aac']]]) execFileSync(ffmpeg,['-y','-v','error',...args,target],{windowsHide:true});
const pdf = await PDFDocument.create(); pdf.addPage([200,300]); pdf.addPage([300,200]); pdf.setTitle('Private title');
const pdfPath = path.join(folder,'two pages.pdf'); writeFileSync(pdfPath,await pdf.save());
const browser = await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',headless:true});
const page = await browser.newPage({viewport:{width:1320,height:950},acceptDownloads:true});
const errors = [], requests = [], results = [];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
page.on('console',message=>{ if (message.type()==='error') console.log('Browser console:',message.text().slice(0,300)); });
const nav = async name => { await page.locator('.sidebar').getByRole('button',{name,exact:true}).first().click(); await page.getByRole('heading',{name,exact:true}).waitFor(); };
const add = async files => { const chooser = page.waitForEvent('filechooser'); await page.locator('.dropzone').click(); await (await chooser).setFiles(files); await page.locator('.file-row').first().waitFor(); };
async function convert(name) {
  await page.locator('.convert-button').click();
  await page.waitForFunction(()=>['completed','failed','cancelled'].some(status=>document.querySelector('.job-row .job-status')?.classList.contains(status)),undefined,{timeout:180000});
  const row = page.locator('.job-row').first();
  assert.equal(await row.locator('.job-status').textContent(),'completed',await row.textContent());
  const download = page.waitForEvent('download'); await row.getByRole('button',{name:/^Download /}).click();
  const result = await download; const target = path.join(folder,`${results.length}-${result.suggestedFilename()}`); await result.saveAs(target);
  const bytes = readFileSync(target); assert.ok(bytes.length>0); results.push({name,target,bytes:bytes.length}); console.log(`Passed ${name}: ${result.suggestedFilename()} (${bytes.length} bytes)`);
  return {target,bytes,row};
}
try {
  const response = await page.goto(site,{waitUntil:'networkidle'}); assert.equal(response.status(),200);
  await page.getByRole('heading',{name:'Your files. Your browser.'}).waitFor();
  assert.equal(await page.getByText('Download Convertor for Windows',{exact:true}).count(),0);
  await nav('Image Converter'); await add([image]);
  await page.getByRole('combobox',{name:'Format',exact:true}).selectOption('jpg');
  await page.getByRole('slider',{name:'Resolution',exact:true}).fill('50');
  await page.waitForFunction(()=>document.querySelectorAll('.comparison img').length===2 && [...document.querySelectorAll('.comparison img')].every(image=>image.naturalWidth>0));
  const jpeg = await convert('image conversion'); assert.equal(jpeg.bytes[0],0xff); assert.equal(jpeg.bytes[1],0xd8);
  await jpeg.row.getByRole('button',{name:/^Preview /}).click(); await page.waitForFunction(()=>document.querySelector('.preview-modal img')?.naturalWidth===80); await page.getByRole('button',{name:'Close preview'}).click();
  await nav('Merge PDFs'); await add([pdfPath]);
  const secondPdf = path.join(folder,'second.pdf'); const single = await PDFDocument.create(); single.addPage([400,500]); writeFileSync(secondPdf,await single.save()); await add([secondPdf]);
  const merged = await convert('PDF merge'); assert.equal((await PDFDocument.load(merged.bytes)).getPageCount(),3);
  await nav('Split & extract PDFs'); await add([pdfPath]); await page.getByRole('textbox',{name:'Pages',exact:true}).fill('2');
  const extracted = await convert('PDF extraction'); assert.equal((await PDFDocument.load(extracted.bytes)).getPageCount(),1);
  await nav('Split & extract PDFs'); await page.getByRole('button',{name:'Split',exact:true}).click(); await page.getByRole('textbox',{name:'Pages',exact:true}).fill('');
  const split = await convert('PDF split'); assert.equal(Object.keys(unzipSync(split.bytes)).length,2);
  await nav('Images to PDF'); await add([image]); const imagePdf = await convert('images to PDF'); assert.equal((await PDFDocument.load(imagePdf.bytes)).getPageCount(),1);
  await nav('PDF to images'); await add([pdfPath]); await page.getByRole('combobox',{name:'Resolution',exact:true}).selectOption('72');
  const rendered = await convert('PDF rasterization'); assert.equal(Object.keys(unzipSync(rendered.bytes)).length,2);
  await nav('Resize, crop & rotate'); await add([image]); await page.getByRole('spinbutton',{name:'Width (px)',exact:true}).fill('40'); await page.getByRole('spinbutton',{name:'Height (px)',exact:true}).fill('40');
  const resized = await convert('image resize'); assert.ok(resized.bytes.length>0);
  await nav('Compress to size'); await add([image]); await page.getByRole('spinbutton',{name:'Maximum size per file (MB)',exact:true}).fill('.01');
  const compressed = await convert('image size limit'); assert.ok(compressed.bytes.length<=10000);
  await nav('Remove metadata'); await add([pdfPath]); const clean = await convert('PDF metadata removal'); assert.equal((await PDFDocument.load(clean.bytes,{updateMetadata:false})).getTitle(),undefined);
  await nav('Audio Converter'); await add([audio]); const mp3 = await convert('WASM audio conversion'); assert.ok(mp3.bytes.length>1000);
  await nav('Video to Audio'); await add([video]); await convert('WASM video soundtrack');
  await nav('Video Converter'); await add([video]); await convert('WASM video conversion');
  await nav('Video to GIF'); await add([video]); const gif = await convert('WASM animated GIF'); assert.equal(gif.bytes.subarray(0,3).toString(),'GIF');
  await nav('Trim audio & video'); await add([video]); await page.getByRole('spinbutton',{name:'End (seconds)',exact:true}).fill('.5'); await convert('WASM trimming');
  await nav('Extract video frames'); await add([video]); const frame = await convert('WASM frame extraction'); assert.equal(frame.bytes[0],0x89);
  for (const format of ['png','webp','bmp','tiff']) {
    await nav('Image Converter'); await page.getByRole('combobox',{name:'Format',exact:true}).selectOption(format); await convert(`image ${format}`);
  }
  for (const format of ['m4a','ogg','wav','flac','aac','opus','aiff','wma','ac3']) {
    await nav('Video to Audio'); await page.getByRole('combobox',{name:'Format',exact:true}).selectOption(format); await convert(`audio ${format}`);
  }
  for (const format of ['webm','mkv','mov']) {
    await nav('Video Converter'); await page.getByRole('combobox',{name:'Format',exact:true}).selectOption(format); await convert(`video ${format}`);
  }
  await nav('Extract video frames'); await page.getByRole('button',{name:'At intervals',exact:true}).click(); await page.getByRole('spinbutton',{name:'Every (seconds)',exact:true}).fill('.3');
  const frames = await convert('frame interval ZIP'); assert.ok(Object.keys(unzipSync(frames.bytes)).length>=3);
  await nav('Compress to size'); await page.getByRole('button',{name:'Clear list',exact:true}).click(); await add([audio]); await page.getByRole('spinbutton',{name:'Maximum size per file (MB)',exact:true}).fill('.02');
  const compactAudio = await convert('audio size limit'); assert.ok(compactAudio.bytes.length<=20000);
  await nav('Compress to size'); await page.getByRole('button',{name:'Clear list',exact:true}).click(); await add([video]); await page.getByRole('spinbutton',{name:'Maximum size per file (MB)',exact:true}).fill('.04');
  const compactVideo = await convert('video size limit'); assert.ok(compactVideo.bytes.length<=40000);
  const longVideo = path.join(folder,'cancel video.mp4');
  execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=size=960x540:rate=30','-t','12','-c:v','libx264','-preset','ultrafast',longVideo],{windowsHide:true});
  await nav('Video Converter'); await page.getByRole('button',{name:'Clear list',exact:true}).click(); await add([longVideo]); await page.getByRole('combobox',{name:'Format',exact:true}).selectOption('webm'); await page.locator('.convert-button').click();
  const running = page.locator('.job-row').filter({has:page.locator('.job-status.running')}).first(); await running.waitFor({timeout:30000}); await running.getByRole('button',{name:/^Cancel /}).click();
  await page.locator('.job-row').first().locator('.job-status.cancelled').waitFor();
  await nav('Audio Converter'); await convert('conversion after cancellation');
  await nav('YouTube Converter'); await page.getByText(/YouTube downloading is unavailable/).waitFor();
  assert.deepEqual(errors,[]);
  assert.equal(requests.some(request=>request.method==='POST'),false,'Files must never be uploaded');
  assert.equal(requests.some(request=>request.url.includes('/api/')),false,'No local helper API may be used');
  assert.ok(requests.some(request=>request.url.includes('.wasm')),'The actual WASM engine must run');
  await page.locator('.sidebar').getByRole('button',{name:'All tools',exact:true}).click();
  await page.screenshot({path:'.tools/browser-only-home.png',fullPage:true});
  const mobile = await browser.newPage({viewport:{width:390,height:844}}); await mobile.goto(site); await mobile.getByRole('heading',{name:'Your files. Your browser.'}).waitFor();
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); await mobile.screenshot({path:'.tools/browser-only-mobile.png',fullPage:true});
  writeFileSync(path.join(folder,'results.json'),JSON.stringify(results,null,2));
  console.log(`Standalone browser checks passed: ${results.length} real exports; no desktop app, helper, or uploads.`);
} finally { await browser.close(); }
