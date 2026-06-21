import playwright from 'playwright';

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Look for the custom date inputs to verify they exist
    const customButtons = await page.locator('text=CUSTOM').count();
    console.log(`Found ${customButtons} CUSTOM buttons (expected 3 for Revenue, Order, Delivery)`);

    await page.screenshot({ path: 'verify-screenshot.png', fullPage: false });
    console.log('Verification screenshot saved');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
