// Isolated actual exports: no production origin, login, storage or Firebase requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PDFLAB_NODE_MODULES || '../node_modules', 'playwright'));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tmp/pdf-layout-20261029');
const synthetic = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json'), 'utf8'));
const origin = 'http://standalone-print.test';
const results = [];
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    let exported = '';
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/preview.html') return route.fulfill({ body: exported, contentType: 'text/html; charset=utf-8' });
      if (/firebase.*config/i.test(url.pathname)) return route.fulfill({ body: '/* isolated */', contentType: 'text/javascript' });
      const file = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream' });
    });
    for (const screen of ['index', 'final_test', 'general_exam']) {
      const page = await context.newPage();
      const errors = [], missing = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });
      await page.goto(origin + '/app/' + screen + '.html?workspace=exam');
      await page.waitForFunction(() => document.body.dataset.appReady === 'true');
      const generated = await page.evaluate(async synthetic => {
        await PDFLabSolbookText.ready();
        const base = { ...readExamExportSettings(), logoSrc: './assets/code-logo.png', includeAnswerKey: true };
        const markup = [], counts = [];
        for (const mode of ['text', 'image']) {
          const settings = { ...base, title: '인쇄 회귀 검증 · ' + mode, contentRenderMode: mode };
          const records = mode === 'text'
            ? synthetic.problems.map(p => PDFLabCanonical.create(p, synthetic, 'synthetic', 'synthetic.json', {
              id: 'synthetic-' + p.number, recordId: 'synthetic-' + p.number, sourceId: 'synthetic', kind: 'problem', textOnly: true, segments: [], segmentImages: []
            }))
            : [1, 2, 3, 4].map(n => {
              const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="600" height="750" fill="white"/><rect x="5" y="5" width="590" height="740" fill="none" stroke="black"/><text x="20" y="60" font-size="24">IMAGE QUESTION ' + n + '</text></svg>';
              return { recordId: 'image-' + n, sourceId: 'images', number: n, kind: 'problem', problemType: '독해', answerText: '①', explanationText: '합성 이미지 해설', segmentBlobs: [new Blob([svg], { type: 'image/svg+xml' })], segmentMeta: [{ x0: 0, x1: 600, y0: 0, y1: 750 }] };
            });
          readExamExportSettings = () => settings;
          getExamSlotAssignedRecords = () => records.map(record => ({ record }));
          hydrateProblemRecordsWithAssets = async records => records;
          const output = await buildExamPreviewDocument('previewUrls');
          const container = document.createElement('div');
          container.innerHTML = output.markup;
          for (const image of container.querySelectorAll('img[src^="blob:"]')) {
            const blob = await fetch(image.src).then(r => r.blob());
            image.src = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          }
          markup.push(container.innerHTML);
          counts.push({ mode, questions: output.totalQuestionCount });
        }
        return { html: buildStandaloneHtmlDocument(markup.join(''), '인쇄 회귀 검증'), counts };
      }, synthetic);
      exported = generated.html;
      fs.writeFileSync(path.join(out, screen + '-print.html'), exported);
      await page.goto(origin + '/preview.html');
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode()));
      });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sheet')).backgroundColor), 'rgb(255, 255, 255)', screen + ': white standalone paper preview');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sheet'), '::before').display), 'none');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', screen + ': white preview canvas');
      assert(await page.locator('.sheet-title').first().isVisible(), screen + ': visible preview title');
      assert(await page.locator('.problem-card').first().isVisible(), screen + ': visible preview question');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(out, screen + '-screen-preview.png'), fullPage: false });
      await page.emulateMedia({ media: 'print' });
      const geometry = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        return [...document.querySelectorAll('.sheet')].map(sheet => ({
          sheet: rect(sheet), columns: [...sheet.querySelectorAll('.sheet-column')].map(rect),
          columnDisplay: getComputedStyle(sheet.querySelector('.sheet-columns')).display,
          logo: sheet.querySelector('.sheet-logo-image') ? rect(sheet.querySelector('.sheet-logo-image')) : null,
          pageColor: getComputedStyle(sheet).backgroundColor,
          pageImage: getComputedStyle(sheet).backgroundImage,
          paperOverlay: getComputedStyle(sheet, '::before').display,
          decorations: [...sheet.querySelectorAll('.problem-card,.problem-badge,.problem-type-badge')].map(el => ({
            color: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage,
            shadow: getComputedStyle(el).boxShadow, stripe: el.matches('.problem-card') ? getComputedStyle(el, '::before').display : 'none'
          }))
        }));
      });
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', screen + ': white print canvas');
      assert(geometry.length >= 2);
      for (const g of geometry) {
        assert.equal(g.pageColor, 'rgb(255, 255, 255)', screen + ': white paper');
        assert.equal(g.pageImage, 'none');
        assert.equal(g.paperOverlay, 'none');
        for (const d of g.decorations) {
          assert(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(d.color));
          assert.equal(d.image, 'none');
          assert.equal(d.shadow, 'none');
          assert.equal(d.stripe, 'none');
        }
        assert(Math.abs(g.sheet.width - 210 * 96 / 25.4) < 1, screen + ': A4 width');
        assert(Math.abs(g.sheet.height - 296.8 * 96 / 25.4) < 1, screen + ': A4 height');
        assert.equal(g.columnDisplay, 'grid');
        assert.equal(g.columns.length, 2);
        assert(g.columns[1].x > g.columns[0].x + g.columns[0].width, screen + ': two columns');
        assert(Math.abs(g.columns[0].y - g.columns[1].y) < 1);
        if (g.logo) {
          assert(g.logo.width > 0 && g.logo.width <= 44 * 96 / 25.4 + 1, screen + ': logo width');
          assert(g.logo.height <= 18 * 96 / 25.4 + 1, screen + ': logo height');
        }
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      await page.pdf({ path: path.join(out, screen + '-print.pdf'), preferCSSPageSize: true, printBackground: true });
      await page.screenshot({ path: path.join(out, screen + '-print.png'), fullPage: false });
      results.push({ screen, counts: generated.counts, geometry, errors, missing });
      await page.close();
      console.log('PASS: ' + screen + ' actual text/image export, white screen previews and print paper, A4, two columns, bounded logo, no errors/missing files');
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
