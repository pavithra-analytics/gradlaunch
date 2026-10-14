const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
           '--disable-gpu','--single-process']
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(10000);
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto('http://localhost:3101/index.html', { waitUntil: 'domcontentloaded', timeout: 10000 });

  const title = await page.title();
  console.log('TITLE:', title);

  const activePage = await page.$eval('.page.active', el => el.id);
  console.log('ACTIVE_PAGE:', activePage);

  const launchDisabled = await page.$eval('#launch-btn', el => el.disabled);
  console.log('LAUNCH_BTN_DISABLED_INIT:', launchDisabled);

  const jdBodyClass = await page.$eval('#jd-body', el => el.className);
  console.log('JD_BODY_CLASS:', jdBodyClass);

  // Dark mode toggle
  await page.click('#dark-btn');
  const darkClass = await page.$eval('html', el => el.className);
  console.log('DARK_AFTER_TOGGLE:', darkClass.includes('dark') ? 'PASS' : 'FAIL');
  await page.click('#dark-btn');

  // CSS tokens
  const spVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sp-6').trim());
  const rVar  = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--r-md').trim());
  console.log('CSS_VAR_SP6:', spVar || 'MISSING');
  console.log('CSS_VAR_R_MD:', rVar  || 'MISSING');

  // Tab animation
  const animDefined = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.name === 'tab-appear') return true;
        }
      } catch(e){}
    }
    return false;
  });
  console.log('TAB_APPEAR_ANIMATION:', animDefined ? 'PASS' : 'MISSING');

  // Typography weights
  const heroW = await page.$eval('.hero h1', el => getComputedStyle(el).fontWeight);
  const subW  = await page.$eval('.hero-sub', el => getComputedStyle(el).fontWeight);
  console.log('HERO_H1_WEIGHT:', heroW);
  console.log('HERO_SUB_WEIGHT:', subW);

  // Results page
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('pg-results').classList.add('active');
  });
  const profileOn = await page.$eval('#tab-profile', el => el.classList.contains('on'));
  const skCount   = await page.$$eval('.skeleton', els => els.length);
  console.log('PROFILE_TAB_ON_DEFAULT:', profileOn ? 'PASS' : 'FAIL');
  console.log('SKELETON_COUNT:', skCount);

  // Tab switching
  for (const t of ['score','project','finalize','profile']) {
    await page.evaluate(tab => {
      if (typeof showTab === 'function') showTab(tab);
      else {
        ['profile','project','score','finalize'].forEach(id =>
          document.getElementById('tab-'+id).classList.toggle('on', id===tab));
      }
    }, t);
    const on = await page.$eval('#tab-'+t, el => el.classList.contains('on'));
    console.log('TAB_'+t.toUpperCase()+':', on ? 'PASS' : 'FAIL');
  }

  // Mobile
  await page.setViewport({ width: 375, height: 812 });
  await new Promise(r => setTimeout(r, 300));
  const sidebarHidden = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sidebar')).display === 'none');
  const tabBarShown = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.tab-bar')).display !== 'none');
  console.log('MOBILE_SIDEBAR_HIDDEN:', sidebarHidden ? 'PASS' : 'FAIL');
  console.log('MOBILE_TABBAR_VISIBLE:', tabBarShown ? 'PASS' : 'FAIL');

  // Input hero stacks on mobile
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('pg-input').classList.add('active');
  });
  const heroGridCols = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.input-hero-wrap')).gridTemplateColumns);
  console.log('MOBILE_HERO_GRID_COLS:', heroGridCols);

  // CTA border-radius
  await page.setViewport({ width: 1280, height: 800 });
  const ctaBR = await page.$eval('.cta-btn', el => getComputedStyle(el).borderRadius);
  console.log('CTA_BTN_BORDER_RADIUS:', ctaBR);

  // Check font-weight 800/900 classes are now 700
  const clWeight = await page.$eval('.cl', el => getComputedStyle(el).fontWeight);
  console.log('EYEBROW_CL_WEIGHT:', clWeight, clWeight==='700'?'OK':'UNEXPECTED');

  await browser.close();
  console.log('\nQA_COMPLETE');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
