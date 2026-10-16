import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle' });
  for (const [width, height] of [[80, 60], [4000, 3000]]) {
    await page.evaluate(async ([width, height]) => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { default: ImageViewer } = await import('/src/ImageViewer.tsx');
      const container = document.createElement('div'); document.body.append(container);
      const root = ReactDOM.createRoot(container);
      const src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="purple"/></svg>`)}`;
      root.render(React.createElement(ImageViewer, { src, label: 'Test image', onClose: () => { root.unmount(); container.remove(); } }));
    }, [width, height]);
    const viewer = page.getByRole('dialog', { name: 'Test image', exact: true });
    await viewer.waitFor();
    const assertFit = async () => page.waitForFunction(() => {
      const area = document.querySelector('.viewer-viewport'); const img = area?.querySelector('img');
      if (!img?.naturalWidth) return false;
      const scale = Math.min((area.clientWidth - 32) / img.naturalWidth, (area.clientHeight - 32) / img.naturalHeight);
      return Math.abs(img.getBoundingClientRect().width / img.naturalWidth - scale) < .001;
    });
    await assertFit();
    const fitted = Number(await viewer.getByRole('slider', { name: 'Image zoom' }).inputValue());
    assert.equal(fitted > 100, width === 80);
    await page.setViewportSize({ width: 1000, height: 700 });
    await assertFit();
    const resized = Number(await viewer.getByRole('slider', { name: 'Image zoom' }).inputValue());
    await viewer.getByRole('slider', { name: 'Image zoom' }).fill(String(resized * 2));
    const area = viewer.locator('.viewer-viewport'); const bounds = await area.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 110, bounds.y + bounds.height / 2 - 90, { steps: 5 });
    await page.mouse.up();
    assert.ok(await area.evaluate(element => element.scrollLeft >= 105 && element.scrollTop >= 85));
    assert.equal(await area.evaluate(element => element.classList.contains('panning')), false);
    await viewer.getByRole('button', { name: 'Fit', exact: true }).click(); await assertFit();
    assert.ok(await area.evaluate(element => element.scrollLeft === 0 && element.scrollTop === 0));
    await page.keyboard.press('Escape');
    assert.equal(await viewer.count(), 0);
    await page.setViewportSize({ width: 1320, height: 950 });
  }
  assert.deepEqual(errors, []);
  console.log('Image viewer checks passed: small/large images fit on open and resize, dragging pans both axes, Fit resets the view, and Escape closes it.');
} finally { await browser.close(); }
