import playwright from 'playwright';

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click the CUSTOM button to open the date picker
    const customButton = await page.locator('button').filter({ hasText: 'CUSTOM' }).first();
    await customButton.click();
    await page.waitForTimeout(800);

    // Take screenshot of initial calendar
    await page.screenshot({ path: 'calendar-initial.png', fullPage: false });
    console.log('Initial calendar screenshot captured');

    // Get all buttons in the picker and find the prev month button (first arrow-like button)
    const buttons = await page.locator('div[class*="z-50"] button').all();
    if (buttons.length > 0) {
      // Click first button in the header (should be prev month)
      await buttons[0].click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'calendar-prev-month.png', fullPage: false });
      console.log('Previous month screenshot captured');
    }

    // Try clicking next month button (should be the second button in header)
    const buttonsAfter = await page.locator('div[class*="z-50"] button').all();
    if (buttonsAfter.length > 1) {
      await buttonsAfter[1].click();
      await page.waitForTimeout(300);
      await buttonsAfter[1].click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'calendar-next-months.png', fullPage: false });
      console.log('Next months screenshot captured');
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
