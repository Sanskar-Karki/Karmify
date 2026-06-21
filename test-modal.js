import playwright from 'playwright';

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    await page.goto('http://localhost:3000/products', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click Add Product button
    await page.click('button:has-text("Add Product")');
    await page.waitForTimeout(1000);

    // Take screenshot of modal
    await page.screenshot({ path: 'modal-screenshot.png' });
    console.log('Modal screenshot captured');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
