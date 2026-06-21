import playwright from 'playwright';

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click the CUSTOM button to open the date picker
    const customButton = await page.locator('button:has-text("CUSTOM")').first();
    await customButton.click();
    await page.waitForTimeout(800);

    // Click a date (e.g., the 15th)
    await page.locator('button:has-text("15")').first().click();
    await page.waitForTimeout(500);

    // Take screenshot after selecting first date
    await page.screenshot({ path: 'picker-after-first-date.png', fullPage: false });
    console.log('Screenshot after first date selection captured');

    // Click another date (e.g., the 20th)
    await page.locator('button:has-text("20")').first().click();
    await page.waitForTimeout(500);

    // Take screenshot after selecting second date
    await page.screenshot({ path: 'picker-after-second-date.png', fullPage: false });
    console.log('Screenshot after second date selection captured');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
