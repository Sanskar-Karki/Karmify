import playwright from 'playwright';

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click the CUSTOM button to show the date picker
    const customButton = await page.locator('text=CUSTOM').first();
    await customButton.click();
    await page.waitForTimeout(800);

    await page.screenshot({ path: 'datepicker-screenshot.png', fullPage: false });
    console.log('Date picker screenshot captured');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
