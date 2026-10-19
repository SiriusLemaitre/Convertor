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
let desktopBrowser;
let appExit;
app.on('exit', (code, signal) => { appExit = `${code ?? signal}`; });
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

  const response = await fetch(endpoint);
  assert.equal(response.status,200);
  assert.match(await response.text(),/<div id="root"><\/div>/);
  const info = await api('app_info');
  assert.ok(info.engines.every(engine => engine.path));
  const [job] = await api('enqueue',{request:{kind:'image',inputs:[selected[0].path],outputDir:folder,outputName:'',bitrate:192,width:640,fps:15,start:0,duration:null,format:'jpg',imageScalePercent:50,imageQuality:80}});
  let finished;
  for (let attempt=0;attempt<100;attempt++) {
    finished = (await api('list_jobs')).find(item=>item.id===job.id);
    if (['completed','failed','cancelled'].includes(finished.status)) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(finished.status,'completed',finished.error);
  assert.ok(statSync(finished.output).size>0);
  writeFileSync(path.join(folder,'result.json'),JSON.stringify({checks:['API authentication','CORS/preflight','DNS rebinding','media authorization','range seeking','native conversion'],output:finished.output},null,2));
  console.log('Optional native browser transport checks passed. Test the standalone website with scripts/check-browser.mjs.');
} finally {
  if (desktopBrowser) await desktopBrowser.close().catch(() => {});
  app.kill();
}
