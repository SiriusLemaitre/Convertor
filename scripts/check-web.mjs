import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';

const binary = path.resolve(process.argv[2] || 'release/Convertor.exe');
const folder = path.resolve('.tools', 'web-smoke');
mkdirSync(folder, { recursive: true });
const image = path.join(folder, 'browser image café.png');
const video = path.join(folder, 'browser video.mp4');
const ffmpeg = path.resolve('src-tauri/binaries/ffmpeg.exe');
execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120', '-frames:v', '1', image], { windowsHide: true });
execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15', '-t', '1', '-c:v', 'libx264', video], { windowsHide: true });
const debugPort = 10000 + process.pid % 40000;
const app = spawn(binary, ['--web'], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env,
    CONVERTOR_WEB_NO_OPEN: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    WEBVIEW2_USER_DATA_FOLDER: path.join(folder, `profile-${Date.now()}`),
  },
});
let desktopBrowser, browser;
let appExit;
app.on('exit', (code, signal) => { appExit = `${code ?? signal}`; });
const errors = [];
try {
  for (let i = 0; i < 60; i++) {
    try { desktopBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    if (appExit !== undefined) throw new Error(`Convertor exited during launch: ${appExit}`);
  }
  assert.ok(desktopBrowser, 'Desktop did not start');
  let desktopPage;
  for (let i = 0; i < 30; i++) {
    desktopPage = desktopBrowser.contexts().flatMap(c => c.pages())[0];
    if (desktopPage) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  await desktopPage.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
  const link = await desktopPage.evaluate(() => window.__TAURI_INTERNALS__.invoke('open_browser', { hosted: false }));
  const url = new URL(link);
  const [, token] = new URLSearchParams(url.hash.slice(1)).get('bridge').split('.');
  const endpoint = url.origin;
  const api = async (command, args = {}) => {
    const response = await fetch(`${endpoint}/api/${command}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    return data;
  };
  const unauthenticated = await fetch(`${endpoint}/api/app_info`, { method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 401);
  const foreign = await fetch(`${endpoint}/api/app_info`, { method: 'POST', headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` }, body: '{}' });
  assert.equal(foreign.status, 403);
  const preflight = await fetch(`${endpoint}/api/app_info`, { method: 'OPTIONS', headers: { Origin: 'https://siriuslemaitre.github.io', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://siriuslemaitre.github.io');
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  const rebinding = await new Promise((resolve, reject) => {
    const request = http.get(`${endpoint}/`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(rebinding, 403);
  const unselected = `${endpoint}/media?${new URLSearchParams({ path: image, token })}`;
  assert.equal((await fetch(unselected)).status, 403);
  const selected = await api('inspect_files', { paths: [image] });
  assert.equal(selected.length, 1);
  assert.equal((await fetch(unselected)).headers.get('content-type'), 'image/png');
  assert.equal((await fetch(unselected, { headers: { Range: 'bytes=0-15' } })).status, 206);
  assert.equal((await fetch(unselected, { headers: { Range: 'bytes=99999999-' } })).status, 416);
  assert.equal((await fetch(`${endpoint}/media?${new URLSearchParams({ path: image, token: '0'.repeat(64) })}`)).status, 401);
  const [selectedVideo] = await api('inspect_files', { paths: [video] });
  const media = await fetch(`${endpoint}/media?${new URLSearchParams({ path: selectedVideo.path, token })}`, { headers: { Range: 'bytes=0-63' } });
  assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 64);

  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1320, height: 950 } });
  page.on('pageerror', e => errors.push(e.message));
  // Only the modal file selection is supplied by the test; all other requests,
  // preview rendering, queue submission, encoding and file serving are real.
  await page.route('**/api/pick_files', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(selected) }));
  await page.goto(link);
  await page.getByText('Processing locally on this computer', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '', 'Pairing secret must leave the address bar');
  assert.equal(await page.locator('.tool-card').count(), 15);
  await page.locator('.sidebar').getByRole('button', { name: 'Image Converter', exact: true }).click();
  await page.locator('.dropzone').click();
  await page.locator('.file-row').waitFor();
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('jpg');
  await page.getByRole('slider', { name: 'Resolution', exact: true }).fill('50');
  await page.waitForFunction(() => [...document.querySelectorAll('.comparison img')].length === 2 && [...document.querySelectorAll('.comparison img')].every(img => img.naturalWidth > 0));
  await page.screenshot({ path: '.tools/web-image-converter.png', fullPage: true });
  await page.getByRole('button', { name: 'Convert to JPG', exact: true }).click();
  await page.locator('.job-status.completed').waitFor({ timeout: 30000 });
  const completed = (await api('list_jobs')).find(job => job.status === 'completed');
  assert.ok(completed.output.endsWith('.jpg')); assert.ok(statSync(completed.output).size > 0);
  const dimensions = JSON.parse(execFileSync(path.resolve('src-tauri/binaries/ffprobe.exe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', completed.output], { windowsHide: true }).toString());
  assert.deepEqual(dimensions.streams[0], { width: 80, height: 60 });
  await page.getByRole('button', { name: /^Preview / }).click();
  await page.locator('.preview-modal img').waitFor();
  await page.waitForFunction(() => document.querySelector('.preview-modal img')?.naturalWidth > 0);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.screenshot({ path: '.tools/web-queue.png', fullPage: true });

  const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  publicPage.on('pageerror', e => errors.push(e.message));
  await publicPage.goto(endpoint);
  await publicPage.getByRole('heading', { name: 'Your toolbox, in your browser.' }).waitFor();
  assert.equal(await publicPage.locator('.browser-connected').count(), 0);
  await publicPage.screenshot({ path: '.tools/web-mobile.png', fullPage: true });
  assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile page should fit the viewport');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(folder, 'result.json'), JSON.stringify({ checks: ['API authentication', 'CORS/preflight', 'DNS rebinding', 'media authorization', 'range seeking', 'private pairing', 'image preview', 'real conversion', 'output preview', 'mobile layout'], output: completed.output }, null, 2));
  console.log('Web checks passed: authentication, origin/host restrictions, streaming, pairing, previews, conversion, mobile layout.');
} finally {
  if (browser) await browser.close();
  if (desktopBrowser) await desktopBrowser.close().catch(() => {});
  app.kill();
}
