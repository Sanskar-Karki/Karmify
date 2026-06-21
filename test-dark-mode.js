import playwright from 'playwright';

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    // Test light mode
    console.log('Testing light mode...');
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'dark-mode-dashboard-light.png', fullPage: true });
    console.log('✓ Light mode dashboard screenshot captured');

    // Switch to dark mode
    console.log('Switching to dark mode...');
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'dark-mode-dashboard-dark.png', fullPage: true });
    console.log('✓ Dark mode dashboard screenshot captured');

    // Test customers page in dark mode
    console.log('Testing customers page...');
    await page.goto('http://localhost:3000/customers', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'dark-mode-customers-dark.png', fullPage: true });
    console.log('✓ Dark mode customers screenshot captured');

    // Test products page in dark mode
    console.log('Testing products page...');
    await page.goto('http://localhost:3000/products', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'dark-mode-products-dark.png', fullPage: true });
    console.log('✓ Dark mode products screenshot captured');

    // Test inventory page in dark mode
    console.log('Testing inventory page...');
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'dark-mode-inventory-dark.png', fullPage: true });
    console.log('✓ Dark mode inventory screenshot captured');

    console.log('\nAll screenshots captured! Check the .png files.');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
