import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const binary = path.resolve(process.env.CONVERTOR_APP || 'release/Convertor.exe');
const folder = path.join(root, '.tools', 'desktop-smoke');
mkdirSync(folder, { recursive: true });
const engine = name => path.join(root, 'src-tauri', 'binaries', `${name}.exe`);
const video = path.join(folder, 'desktop video.mp4');
const image = path.join(folder, 'desktop image café.png');
const audio = path.join(folder, 'desktop audio.wav');
execFileSync(engine('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120', '-frames:v', '1', image], { windowsHide: true });
execFileSync(engine('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', audio], { windowsHide: true });
execFileSync(engine('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', video], { windowsHide: true });
function pdf(filename, width) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 400] /Resources << >> /Contents 4 0 R >>`, '<< /Length 0 >>\nstream\n\nendstream'];
  let data = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(data);
  data += 'xref\n0 5\n0000000000 65535 f \n';
  for (const offset of offsets) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  data += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(filename, data);
}
const firstPdf = path.join(folder, 'first café.pdf');
const secondPdf = path.join(folder, 'second.pdf');
pdf(firstPdf, 200); pdf(secondPdf, 300);
const app = spawn(binary, [], {
  windowsHide: true,
  env: { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223', WEBVIEW2_USER_DATA_FOLDER: path.join(folder, 'webview-data') },
  stdio: 'ignore',
});
let browser;
const errors = [];
try {
  for (let retry = 0; retry < 40; retry++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9223'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(browser, 'Desktop WebView2 did not start');
  let page;
  for (let retry = 0; retry < 30; retry++) {
    page = browser.contexts().flatMap(context => context.pages())[0];
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(page, 'Desktop window did not create a page');
  page.on('pageerror', e => errors.push(e.message));
  // Reset only this script's isolated WebView profile for a repeatable run.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
  assert.equal(await page.locator('.preview-banner').count(), 0);
  const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('app_info'));
  assert.ok(info.engines.every(engine => engine.path && engine.version));
  const normalize = filename => filename.replace(/^\\\\\?\\/, '').toLowerCase();
  assert.ok(info.engines.every(engine => normalize(engine.path).startsWith(normalize(path.dirname(binary)))), `The portable app must use bundled engines: ${JSON.stringify(info.engines)}`);
  await page.screenshot({ path: '.tools/desktop-home.png', fullPage: true });
  // Supply a native drop event without operating a modal file picker.
  // Inspection, validation, job submission, and conversion all use real Rust commands.
  for (const tool of ['Video to MP3', 'Video to GIF', 'Merge PDFs']) {
    await page.locator('.sidebar').getByRole('button', { name: tool, exact: true }).click();
    await page.evaluate(inputs => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: inputs, position: { x: 400, y: 300 } } }), tool === 'Merge PDFs' ? [secondPdf, firstPdf] : [video]);
    await page.locator('.file-row').first().waitFor();
    if (tool === 'Video to GIF') {
      assert.equal(await page.getByRole('button', { name: 'Full video', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('spinbutton', { name: 'Length (seconds)' }).count(), 0);
    }
    if (tool === 'Merge PDFs') {
      await page.getByRole('button', { name: 'Move first café.pdf up', exact: true }).click();
      assert.equal(await page.locator('.file-detail strong').first().textContent(), 'first café.pdf');
      await page.getByRole('textbox', { name: 'Document name' }).fill('desktop merged');
    }
    await page.locator('.convert-button').click();
    await page.getByRole('heading', { name: 'Job queue', exact: true }).waitFor();
    const row = page.locator('.job-row').first();
    await row.locator('.job-status.completed').waitFor({ timeout: 20000 });
  }
  await page.locator('.sidebar').getByRole('button', { name: 'Images', exact: true }).click();
  await page.evaluate(inputs => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: inputs, position: { x: 400, y: 300 } } }), [image]);
  const size = page.locator('[data-testid="image-preview-size"][data-bytes]');
  await size.waitFor();
  const resolution = page.getByRole('slider', { name: 'Resolution', exact: true });
  await resolution.press('Home');
  assert.equal(await page.locator('.convert-button').isDisabled(), true);
  await page.getByText('Select more than 0%.', { exact: true }).waitFor();
  await resolution.press('End');
  for (let index = 0; index < 50; index++) await resolution.press('ArrowLeft');
  assert.equal(await resolution.inputValue(), '50');
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('jpg');
  await page.getByRole('slider', { name: /Quality/ }).press('Home');
  await size.waitFor();
  const lowQualityBytes = Number(await size.getAttribute('data-bytes'));
  await page.getByRole('slider', { name: /Quality/ }).press('End');
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('img', { name: 'Output preview', exact: true }).waitFor();
  await page.waitForFunction(previous => Number(document.querySelector('[data-testid="image-preview-size"]')?.getAttribute('data-bytes')) > previous, lowQualityBytes);
  const previewBytes = Number(await size.getAttribute('data-bytes'));
  assert.equal(await page.locator('.preview-row').getAttribute('data-width'), '80');
  assert.equal(await page.locator('.preview-row').getAttribute('data-height'), '60');
  await page.screenshot({ path: '.tools/desktop-images.png', fullPage: true });
  await page.locator('.convert-button').click();
  await page.locator('.job-row').first().locator('.job-status.completed').waitFor({ timeout: 20000 });
  const imageJobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_jobs'));
  assert.equal(statSync(imageJobs.find(job => job.kind === 'image').output).size, previewBytes);
  for (const format of ['mp3', 'ogg', 'wav', 'flac', 'm4a']) {
    await page.locator('.sidebar').getByRole('button', { name: 'Audio', exact: true }).click();
    await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption(format);
    await page.evaluate(inputs => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: inputs, position: { x: 400, y: 300 } } }), [audio]);
    await page.locator('.file-row').waitFor();
    await page.locator('.convert-button').click();
    await page.locator('.job-row').first().locator('.job-status.completed').waitFor({ timeout: 20000 });
  }
  for (const format of ['mp4', 'mkv', 'webm', 'mov']) {
    await page.locator('.sidebar').getByRole('button', { name: 'Video', exact: true }).click();
    await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption(format);
    await page.getByRole('combobox', { name: 'Resolution', exact: true }).selectOption('720');
    await page.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('15');
    await page.evaluate(inputs => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: inputs, position: { x: 400, y: 300 } } }), [video]);
    const estimate = page.locator('[data-testid="video-estimate-size"][data-bytes]');
    await page.getByRole('slider', { name: 'Video quality', exact: true }).press('Home');
    await estimate.waitFor();
    const low = Number(await estimate.getAttribute('data-bytes'));
    await page.getByRole('slider', { name: 'Video quality', exact: true }).press('End');
    await page.waitForFunction(previous => Number(document.querySelector('[data-testid="video-estimate-size"]')?.getAttribute('data-bytes')) > previous, low);
    await page.screenshot({ path: `.tools/desktop-video-${format}.png`, fullPage: true });
    await page.locator('.convert-button').click();
    await page.locator('.job-row').first().locator('.job-status.completed').waitFor({ timeout: 20000 });
  }
  const jobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_jobs'));
  assert.equal(jobs.length, 13);
  assert.ok(jobs.every(job => job.status === 'completed' && job.output));
  const gif = jobs.find(job => job.kind === 'gif').output.replace(/^\\\\\?\\/, '');
  const gifDuration = Number(execFileSync(engine('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', gif], { windowsHide: true, encoding: 'utf8' }).trim());
  assert.ok(Math.abs(gifDuration - 2) < 0.15, `Full-video GIF duration was ${gifDuration}`);
  const merged = jobs.find(job => job.kind === 'pdf').output.replace(/^\\\\\?\\/, '');
  assert.equal(execFileSync(engine('qpdf'), ['--show-npages', merged], { windowsHide: true, encoding: 'utf8' }).trim(), '2');
  await page.screenshot({ path: '.tools/desktop-queue.png', fullPage: true });
  // Exercise the new tools through the real UI and native job queue.
  const navigate = async name => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).first().click();
    await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
  };
  const drop = async inputs => {
    await page.evaluate(inputs => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: inputs, position: { x: 400, y: 300 } } }), inputs);
    await page.locator('.file-row').first().waitFor();
  };
  const exportJob = async () => {
    await page.locator('.convert-button').click();
    await page.getByRole('heading', { name: 'Job queue', exact: true }).waitFor();
    await page.locator('.job-row').first().locator('.job-status.completed').waitFor({ timeout: 30000 });
    return (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_jobs')))[0];
  };
  await navigate('Resize, crop & rotate'); await drop([image]);
  await page.getByRole('spinbutton', { name: 'Width (px)' }).fill('80');
  await page.getByRole('spinbutton', { name: 'Height (px)' }).fill('80');
  await page.getByRole('combobox', { name: 'Center crop' }).selectOption('1:1');
  await page.getByRole('combobox', { name: 'Rotate clockwise' }).selectOption('90');
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('img', { name: 'Output preview', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.comparison img')].every(img => img.naturalWidth > 0));
  await page.screenshot({ path: '.tools/desktop-image-edit.png', fullPage: true });
  await navigate('Job queue');
  // Mouse side buttons restore the tool and its sources/options.
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 3, cancelable: true })));
  await page.getByRole('heading', { name: 'Resize, crop & rotate', exact: true }).waitFor();
  assert.equal(await page.locator('.file-row').count(),1);
  assert.equal(await page.getByRole('spinbutton', { name: 'Width (px)' }).inputValue(),'80');
  await exportJob();
  await navigate('Images to PDF'); await drop([image]);
  await page.getByRole('textbox', { name: 'Document name' }).fill('desktop photos');
  await exportJob();
  for (const operation of ['extract','remove','split']) {
    await navigate('Split & extract PDFs');
    if (!await page.locator('.file-row').count()) await drop([merged]);
    await page.getByRole('button', { name: operation[0].toUpperCase()+operation.slice(1), exact: true }).click();
    await page.getByRole('textbox', { name: operation === 'remove' ? 'Pages to remove' : 'Pages', exact: true }).fill(operation === 'split' ? '' : '1');
    const result = await exportJob();
    assert.equal(result.outputIsDirectory,operation === 'split');
  }
  await navigate('PDF to images'); await drop([merged]);
  await page.getByRole('button', { name: 'Preview selected page', exact: true }).click();
  await page.getByRole('img', { name: 'PDF page preview', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('jpg');
  const rendered = await exportJob(); assert.equal(rendered.outputIsDirectory,true);
  for (const source of [video,audio]) {
    await navigate('Trim audio & video');
    if (await page.getByRole('button', { name: 'Clear list', exact: true }).count()) await page.getByRole('button', { name: 'Clear list', exact: true }).click();
    await drop([source]);
    await page.getByRole('spinbutton', { name: 'Start (seconds)' }).fill('0.2');
    await page.getByRole('spinbutton', { name: 'End (seconds)' }).fill('0.7');
    const result = await exportJob(); assert.match(result.output,source === video ? /\.mp4$/ : /\.m4a$/);
  }
  await navigate('Extract video frames'); await drop([video]);
  await page.getByRole('spinbutton', { name: 'Start / timestamp (seconds)' }).fill('0.5');
  await page.getByRole('button', { name: 'Preview frame', exact: true }).click();
  await page.getByRole('img', { name: 'Video frame preview', exact: true }).waitFor();
  await exportJob();
  await navigate('Extract video frames');
  await page.getByRole('button', { name: 'At intervals', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Every (seconds)' }).fill('0.5');
  assert.equal((await exportJob()).outputIsDirectory,true);
  await navigate('Compress to size'); await drop([video,audio,image]);
  await page.getByRole('spinbutton', { name: 'Maximum size per file (MB)' }).fill('0.05');
  await exportJob();
  await page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke('list_jobs')).filter(j => j.kind === 'compress').every(j => j.status === 'completed'), null, { timeout: 30000 });
  const compressed = (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_jobs'))).filter(j => j.kind === 'compress');
  assert.equal(compressed.length,3);
  for (const job of compressed) assert.ok(statSync(job.output).size <= 50000);
  await navigate('Remove metadata'); await drop([video,audio,image,merged]);
  await exportJob();
  await page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke('list_jobs')).filter(j => j.kind === 'metadata').every(j => j.status === 'completed'), null, { timeout: 30000 });
  const completed = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_jobs'));
  assert.equal(completed.length,30);
  assert.ok(completed.every(j => j.status === 'completed'),JSON.stringify(completed.filter(j => j.status !== 'completed')));
  await page.locator('.job-row').filter({ hasText: 'Resize, crop & rotate' }).getByRole('button', { name: /^Preview/ }).click();
  await page.getByRole('dialog', { name: 'Output preview' }).waitFor();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.screenshot({ path: '.tools/desktop-toolbox-queue.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Desktop checks passed: all 14 tools, previews, source retention, mouse navigation, all audio/video formats, and verified size limits.');
} finally {
  if (browser) await browser.close();
  app.kill();
}
