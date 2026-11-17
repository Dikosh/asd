// Растровые значки приложения из web/public/icon.svg (нужны для установки на телефон и push): node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync('web/public/icon.svg', 'utf8');
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await page.screenshot({ path: `web/public/icon-${size}.png`, omitBackground: true });
    await page.close();
  }
  await browser.close();
})();
