// Optional visual QA. Uses an already installed Playwright/Chromium; installs nothing.
// Start the demo as docs/DEVELOPMENT.md describes, then node --import tsx scripts/check-web-parity.mjs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildLedgerDashboard } from '../src/engine/ledger-dashboard.ts';
const modulePath = process.env.PLAYWRIGHT_MODULE
  || '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright/index.mjs';
const executablePath = process.env.CHROMIUM_EXECUTABLE
  || join(
    homedir(),
    'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
if (!existsSync(modulePath) || !existsSync(executablePath))
  throw new Error(
    "No installed headless browser at these paths. Set PLAYWRIGHT_MODULE "
    + "and CHROMIUM_EXECUTABLE; do not install one for this brief.");
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({
  executablePath
});
const url = process.env.ARESIUM_DEMO_URL || 'http://127.0.0.1:5188/demo';
await mkdir('build', {
  recursive: true
});
const report = {
  screens: [],
  runs: [],
  demoApiRequests: 0
};
try {
  for (const language of ['en', 'de'])
    for (const [width, layout] of [[1440, 'desktop'], [390, 'phone']]) {
      const page = await browser.newPage(
        {
          viewport: {
            width,
            height: 980
          },
          locale: language === 'de' ? 'de-DE' : 'en-GB',
          reducedMotion: 'reduce'
        });
      const runStart = report.screens.length;
      const errors = [];
      const apiRequests = [];
      page.on('dialog', (dialog) => dialog.accept());
      page.on('pageerror', (e) => errors.push(e.message));
      page.on(
        'console',
        (message) => {
          if (message.type() === 'error')
            errors.push(message.text());
        });
      page.on(
        'request',
        (r) => {
          if (new URL(r.url()).pathname.startsWith('/api/'))
            apiRequests.push(r.url());
        });
      await page.goto(url);
      await page.evaluate(
        ({ language }) => {
          localStorage.setItem('aresium.language', language);
          localStorage.setItem('aresium-appearance', language === 'de' ? 'light' : 'dark');
        },
        {
          language
        });
      await page.reload();
      await page.waitForFunction(() => !!window.AresiumPages && !!window.AresiumData.raw.summedLists);
      await page.waitForTimeout(950);
      const tr = (en, de) => language === 'de' ? de : en;
      const capture = async (name) => {
        await page.waitForTimeout(100);
        const overflow = await page.evaluate(
          () => ({
            body: document.documentElement.scrollWidth > innerWidth + 1,
            page: [...document.querySelectorAll('.dashboard-page')].some((e) => e.scrollWidth > e.clientWidth + 1)
          }));
        assert.equal(overflow.body, false, `${language}/${layout}/${name}: body overflow`);
        assert.equal(overflow.page, false, `${language}/${layout}/${name}: page overflow`);
        const controls = await page.evaluate(() => {
          const ticks = [...document.querySelectorAll('input[type="checkbox"],input[type="radio"]')];
          const captions = [...document.querySelectorAll('.payback-pick small,.txn-city')];
          const fixedRows = [...document.querySelectorAll('.fixed-row:has(.fixed-open)')];
          return {
            nativeTicks: ticks.filter((input) => getComputedStyle(input).appearance !== 'none').length,
            looseSeparators: captions.map((node) => node.textContent.trim()).filter((text) => /^·|·$/.test(text)),
            misalignedActions: fixedRows.filter((row) => {
              const name = row.querySelector('.fixed-open').getBoundingClientRect();
              const action = row.querySelector('.md-edit').getBoundingClientRect();
              return Math.abs(name.top - action.top) > 3;
            }).length
          };
        });
        assert.equal(controls.nativeTicks, 0, `${language}/${layout}/${name}: native tick controls`);
        assert.deepEqual(controls.looseSeparators, [], `${language}/${layout}/${name}: loose separators`);
        assert.equal(controls.misalignedActions, 0, `${language}/${layout}/${name}: fixed-cost action alignment`);
        const file = `build/218-${name}${language === 'de' ? '-de' : ''}-${layout}.png`;
        await page.screenshot({
          path: file,
          animations: 'disabled'
        });
        report.screens.push(file);
      };
      const open = async (route) => {
        await page.evaluate((route) => window.AresiumPages.open(route), route);
        await page.waitForTimeout(100);
      };
      if (layout === 'phone') {
        await capture('current');
        await page.getByRole('button', {
          name: tr('Overview', 'Übersicht'),
          exact: true
        }).click();
        await page.waitForTimeout(150);
      }
      await capture('overview');
      // Follow the actual search → name → month → payment buttons.
      await page.getByRole('button', {
        name: tr('Search', 'Suchen'),
        exact: true
      }).click();
      await page.locator('.dashboard-page input[type=search]').fill('Fictional Dinner');
      await page.locator('.name-result').first().waitFor();
      await capture('search');
      await page.locator('.name-result').first().click();
      await page.locator('.name-chart').waitFor();
      await page.waitForTimeout(950);
      await capture('name');
      await page.locator('.name-result').first().click();
      await page.locator('.txn-row').first().waitFor();
      await capture('name-month');
      await page.locator('.txn-row').first().click();
      await page.locator('.payback-detail').waitFor();
      await capture('payment');
      await open({
        screen: 'day',
        day: '2026-06-05'
      });
      await capture('day');
      await page.locator('.dashboard-page').getByRole('button', {
        name: tr('Income', 'Einnahmen'),
        exact: true
      }).click();
      await capture('day-income');
      await open({
        screen: 'fixed',
        side: 'expenses'
      });
      await capture('fixed-costs');
      await page.locator('.dashboard-page').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await capture('fixed-ended');
      await page.getByRole('button', {
        name: tr('Not fixed', 'Nicht fix'),
        exact: true
      }).first().click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /Log in|Melde dich/);
      await open({
        screen: 'fixed',
        side: 'income'
      });
      await capture('regular-income');
      await open({
        screen: 'payback',
        ids: ['sample-dinner', 'sample-course']
      });
      await page.locator('.payback-pick').first().waitFor();
      await page.getByLabel(tr('Search all payments', 'Alle Zahlungen durchsuchen')).fill('Fictional Friend');
      await page.locator('.payback-pick input').nth(0).check();
      await page.locator('.payback-pick input').nth(1).check();
      await page.locator('.payback-summary').waitFor();
      await capture('paybacks');
      assert.match(await page.locator('.payback-summary').innerText(), /15[.,]00/);
      await page.getByRole('button', {
        name: tr('Link', 'Verknüpfen'),
        exact: true
      }).click();
      await page.getByRole('alert').waitFor();
      await open(
        {
          screen: 'categoryPayments',
          cat: 'Restaurants',
          month: '2026-06'
        });
      await page.getByRole(
        'button',
        {
          name: tr('Add up names', 'Namen zusammenzählen'),
          exact: true
        }).click();
      await capture('sums');
      await page.getByRole(
        'button',
        {
          name: tr('Show payments', 'Zahlungen anzeigen'),
          exact: true
        }).click();
      await page.getByRole('button', {
        name: tr('Select', 'Auswählen'),
        exact: true
      }).click();
      const checks = page.locator('.selection-row > input:not(:disabled)');
      await checks.nth(0).click();
      await checks.nth(2).click({
        modifiers: ['Shift']
      });
      assert.equal(await page.locator('.selection-row > input:checked').count(), 3);
      await capture('selection');
      await open({
        screen: 'batchCategory',
        ids: ['sample-dinner', 'sample-course']
      });
      await page.locator('.recat-pick').first().click();
      await capture('batch');
      await page.getByRole('button', {
        name: tr('Add', 'Hinzufügen'),
        exact: true
      }).click();
      await page.locator('.recat-pick').first().click();
      await capture('batch-add');
      await open({
        screen: 'rename',
        ids: ['sample-dinner']
      });
      await capture('rename');
      await open({
        screen: 'quickSort'
      });
      await capture('quick-sort');
      await page.getByRole('button', {
        name: tr('Skip', 'Überspringen'),
        exact: true
      }).click();
      assert.equal(await page.locator('.dashboard-page h2').innerText(), 'Fictional Club');
      await open({
        screen: 'categories'
      });
      await capture('categories');
      await page.locator('.dashboard-page').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await capture('categories-bottom');
      await page.locator('.dashboard-page').evaluate((node) => { node.scrollTop = 0; });
      await page.getByRole('button', {
        name: new RegExp(tr('New category', 'Neue Kategorie'))
      }).first().click();
      await page.getByPlaceholder('Name').fill('Fictional Garden');
      await capture('new-category');
      await page.locator('.category-setting').first().getByRole('button', {
        name: tr('Rename', 'Umbenennen'),
        exact: true
      }).click();
      await capture('rename-category');
      await page.getByRole(
        'dialog',
        {
          name: tr('Rename category', 'Kategorie umbenennen'),
          exact: true
        }).getByRole('button', {
          name: tr('Cancel', 'Abbrechen'),
          exact: true
        }).click();
      await page.locator('.category-setting').first().getByRole('button', {
        name: tr('Remove', 'Entfernen'),
        exact: true
      }).click();
      await capture('delete-category');
      await page.getByRole('alertdialog').getByRole('button', {
        name: tr('Cancel', 'Abbrechen'),
        exact: true
      }).click();
      await open({
        screen: 'cash'
      });
      await capture('cash');
      await page.getByRole('button', {
        name: tr('Add cash', 'Bargeld eintragen'),
        exact: true
      }).click();
      await capture('cash-entry');
      await open({
        screen: 'help'
      });
      await capture('help');
      // Every mutation is refused locally, including requests not normally reached by a button.
      const before = await page.evaluate(() => JSON.stringify(window.AresiumData.raw));
      for (const path of [
        '/api/fixed-costs',
        '/api/undo',
        '/api/paybacks',
        '/api/paybacks/link',
        '/api/names',
        '/api/names/display',
        '/api/transactions',
        '/api/quick-sort',
        '/api/categories',
        '/api/cash',
        '/api/import'
      ]) {
        const status = await page.evaluate(
          async (path) => (await fetch(
            path,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: '{}'
            })).status,
          path);
        assert.equal(status, 403, path);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(window.AresiumData.raw)), before);
      // The tour must advance through all 22 actual pages without a rendering error.
      await page.evaluate(() => window.dispatchEvent(new Event('aresium:tour')));
      await page.locator('.tour-bar').waitFor();
      await capture('tour');
      for (let i = 0; i < 22; i++) {
        await page.locator('.tour-bar').getByRole(
          'button',
          {
            name: i === 21 ? tr('Done', 'Fertig') : tr('Next', 'Weiter'),
            exact: true
          }).click();
        await page.waitForTimeout(80);
      }
      await page.locator('.tour-bar').waitFor({
        state: 'hidden'
      });
      assert.deepEqual(apiRequests, []);
      assert.deepEqual(errors, []);
      await page.close();
      // Empty dashboards must work at either width and offer the actual import and sample tour.
      const emptyPage = await browser.newPage(
        {
          viewport: {
            width,
            height: 980
          },
          locale: language === 'de' ? 'de-DE' : 'en-GB'
        });
      const empty = buildLedgerDashboard(
        {
          months: [],
          categories: [],
          transactions: [],
          openingBalance: 0,
          balanceByDay: {},
          databaseCategoryNames: []
        },
        [],
        undefined,
        '2026-11-03');
      await emptyPage.route(
        '**/app/dashboard.sample.json',
        (r) => r.fulfill(
          {
            contentType: 'application/json',
            body: JSON.stringify(empty)
          }));
      await emptyPage.goto(url);
      await emptyPage.evaluate((language) => localStorage.setItem('aresium.language', language), language);
      await emptyPage.reload();
      await emptyPage.getByRole(
        'heading',
        {
          name: tr('No data yet', 'Noch keine Daten'),
          exact: true
        }).waitFor();
      const emptyFile = `build/218-empty${language === 'de' ? '-de' : ''}-${layout}.png`;
      await emptyPage.screenshot({
        path: emptyFile
      });
      report.screens.push(emptyFile);
      await emptyPage.close();
      report.runs.push(
        {
          language,
          layout,
          width,
          screens: report.screens.length - runStart,
          errors: 0
        });
      console.log(
        `${language} ${layout}: navigation, selection, tour, empty state and demo refusals passed`);
    }
  await writeFile('build/218-browser-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.screens.length} screenshots; no real API requests or browser errors.`);
} finally {
  await browser.close();
}
