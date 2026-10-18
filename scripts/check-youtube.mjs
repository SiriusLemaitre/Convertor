import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Requires internet. Use a short public video, or pass a video URL as the first argument.
const url = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const expectedTitle = process.argv[3] || (process.argv[2] ? null : 'Me at the zoo');
const folder = path.resolve('.tools/youtube-smoke', `title-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const port = 10000 + process.pid % 40000;
const app = spawn(path.resolve('release/Convertor.exe'), [], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(folder, `profile-${Date.now()}`) },
});
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(browser, 'Desktop app did not start');
  const page = browser.contexts().flatMap(c => c.pages())[0];
  await page.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
  const invoke = (cmd, args = {}) => page.evaluate(({cmd, args}) => window.__TAURI_INTERNALS__.invoke(cmd, args), {cmd, args});
  const info = await invoke('app_info');
  assert.ok(info.engines.every(e => e.path), 'All engines must be bundled');
  const request = { kind: 'youtube', inputs: [url], outputDir: folder, outputName: 'YouTube smoke', format: 'mp3', bitrate: 192, width: 640, fps: 15, start: 0, duration: null, videoHeight: 360, videoQuality: 65 };
  await assert.rejects(invoke('enqueue', { request: { ...request, inputs: ['https://youtube.com.evil.invalid/watch?v=test'] } }));
  const outputs = [];
  for (const format of ['mp3', 'mp4', 'mp3']) {
    const [job] = await invoke('enqueue', { request: { ...request, format } });
    let result;
    for (let i = 0; i < 360; i++) {
      result = (await invoke('list_jobs')).find(j => j.id === job.id);
      if (['completed', 'failed', 'cancelled'].includes(result.status)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(result.status, 'completed', result.error || 'Job timed out');
    assert.equal(path.extname(result.output), `.${format}`);
    if (expectedTitle) {
      const suffix = outputs.some(output => path.extname(output) === `.${format}`) ? ' (1)' : '';
      assert.equal(path.basename(result.output), `${expectedTitle}${suffix}.${format}`, 'Output must use the video title and preserve existing downloads');
    }
    assert.ok(!outputs.includes(result.output), 'Repeated downloads must use separate filenames');
    outputs.push(result.output);
    assert.ok(statSync(result.output).size > 0);
    const probe = JSON.parse(execFileSync(path.resolve('release/binaries/ffprobe.exe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result.output], { encoding: 'utf8', windowsHide: true }));
    assert.ok(Number(probe.format.duration) > 0);
    assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
    if (format === 'mp4') assert.ok(probe.streams.some(s => s.codec_type === 'video' && s.height <= 360));
    console.log(`YouTube ${format.toUpperCase()} verified: ${statSync(result.output).size} bytes`);
  }
  assert.equal(readdirSync(folder).filter(name => name.startsWith('.convertor-')).length, 0, 'Download temporary files must be removed');
} finally {
  if (browser) await browser.close();
  if (app.exitCode === null) {
    execFileSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}
