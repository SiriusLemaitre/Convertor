import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1320, height: 950 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
  assert.equal(await page.locator('.tool-card').count(), 6);
  await page.screenshot({ path: '.tools/home-preview.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Find a tool' }).fill('gif');
  assert.equal(await page.locator('.tool-card').count(), 1);
  await page.locator('.tool-card').click();
  await page.getByRole('heading', { name: 'Video to GIF', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Convert to GIF', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Full video', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('spinbutton', { name: 'Length (seconds)' }).count(), 0);
  await page.getByRole('button', { name: 'Trim', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Length (seconds)' }).fill('10');
  await page.getByRole('button', { name: 'Full video', exact: true }).click();
  assert.equal(await page.getByRole('spinbutton', { name: 'Length (seconds)' }).count(), 0);
  await page.getByRole('button', { name: /Add videos/ }).click();
  await page.getByRole('status').filter({ hasText: 'Launch the desktop app' }).waitFor();
  await page.screenshot({ path: '.tools/converter-preview.png', fullPage: true });
  await page.locator('.sidebar').getByRole('button', { name: 'Images', exact: true }).click();
  await page.getByRole('heading', { name: 'Images', exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Format', exact: true }).locator('option').count(), 5);
  const resolution = page.getByRole('slider', { name: 'Resolution', exact: true });
  assert.equal(await resolution.inputValue(), '100');
  assert.equal(await resolution.getAttribute('min'), '0');
  assert.equal(await resolution.getAttribute('max'), '100');
  await resolution.press('Home');
  await page.getByText('Select more than 0%.', { exact: true }).waitFor();
  await resolution.press('End');
  for (let index = 0; index < 50; index++) await resolution.press('ArrowLeft');
  assert.equal(await resolution.inputValue(), '50');
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('jpg');
  await page.getByRole('slider', { name: /Quality/ }).waitFor();
  await page.screenshot({ path: '.tools/image-preview.png', fullPage: true });
  await page.locator('.sidebar').getByRole('button', { name: 'Video', exact: true }).click();
  assert.deepEqual(await page.getByRole('combobox', { name: 'Format', exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['mp4', 'mkv', 'webm', 'mov']);
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webm');
  await page.getByRole('combobox', { name: 'Resolution', exact: true }).selectOption('720');
  await page.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('24');
  await page.getByRole('slider', { name: 'Video quality', exact: true }).press('Home');
  assert.equal(await page.getByRole('slider', { name: 'Video quality', exact: true }).inputValue(), '1');
  await page.getByText('Add videos to estimate size.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Convert to WEBM', exact: true }).isDisabled(), true);
  await page.screenshot({ path: '.tools/video-preview.png', fullPage: true });
  await page.locator('.sidebar').getByRole('button', { name: 'Audio', exact: true }).click();
  assert.deepEqual(await page.getByRole('combobox', { name: 'Format', exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['mp3', 'ogg', 'wav', 'flac', 'm4a']);
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('flac');
  assert.equal(await page.getByRole('button', { name: '192 kbps', exact: true }).count(), 0);
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('m4a');
  assert.equal(await page.getByRole('button', { name: '192 kbps', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Job queue', exact: true }).click();
  await page.getByText('No jobs.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('UI checks passed: navigation, filtering, settings, queue, and browser preview behavior.');
} finally {
  await browser.close();
}
