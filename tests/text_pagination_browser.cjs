// Isolated browser QA, no Firebase or user's browser profile. Outputs are QA-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PDFLAB_NODE_MODULES ? path.join(process.env.PDFLAB_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://pagination.test';
const out = path.join(root, 'tmp/pdfs/text-pagination-qa');
const record = (number, body, choices = []) => ({ recordId: 'qa-' + number, kind: 'problem', number,
  problemType: '내용', textOnly: true, textStructure: { templateKey: 'objective-common',
    questionText: '다음 글의 내용과 일치하지 [[u:않는]] 것은?', bodyText: body,
    choices: choices.map((text, i) => ({ marker: '①②③④⑤'[i], text })) }, answerText: '1', explanationText: '확인용 해설입니다.' });
const sentence = 'Students work together in a small town. They learn from each other and develop useful ideas. ';
// --stdin accepts a read-only snapshot for reproducing particular library items.
const fixtures = process.argv.includes('--stdin') ? JSON.parse(fs.readFileSync(0, 'utf8')) :
  [record(17, sentence.repeat(23), Array(5).fill(sentence)),
    record(44, sentence.repeat(30), Array(5).fill(sentence.repeat(3))), record(45, 'This short question follows the long question.')];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const app of ['index', 'final_test']) {
      const context = await browser.newContext();
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' };
        return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/app/' + app + '.html?workspace=exam');
      const result = await page.evaluate(async fixtures => {
        await PDFLabSolbookText.ready();
        const settings = { ...readExamExportSettings(), contentRenderMode: 'text', title: '긴 문항 이어 출력 검증',
          subtitle: '원문 · 글자 크기 · 선지 번호 유지', kicker: 'PDF LAB', logoSrc: '', includeAnswerKey: true };
        readExamExportSettings = () => settings;
        getExamSlotAssignedRecords = () => fixtures.map(record => ({ record }));
        hydrateProblemRecordsWithAssets = async () => { throw Error('Unexpected Storage access'); };
        const before = JSON.stringify(fixtures);
        const preview = await buildExamPreviewDocument('exportUrls');
        if (JSON.stringify(fixtures) !== before) throw Error('Library records mutated');
        const runtimes = fixtures.map((r, i) => createExamRuntimeProblemFromRecord(r, i + 1, 'previewUrls', 'text'));
        const check = (problem) => {
          const before = JSON.stringify(problem);
          const layout = buildLayoutPages(settings, [problem]);
          PDFLabSolbookText.assertFits(layout.sheets);
          const parts = layout.sheets.flatMap(s => s.columns.flatMap(c => c.items));
          const plain = html => {
            const box = document.createElement('div'); box.innerHTML = html;
            box.querySelectorAll('[data-repeated-marker]').forEach(n => n.remove());
            return box.textContent.replace(/\s+/g, '');
          };
          const expected = plain(buildProblemTextMarkup(problem));
          const actual = parts.map(e => plain(buildProblemTextMarkup(e.problem))).join('');
          if (actual !== expected) throw Error('Text lost or duplicated in ' + problem.number);
          if (JSON.stringify(problem) !== before) throw Error('Runtime input mutated');
          if (parts.some(e => e.fitScale !== 1)) throw Error('Font scaled');
          if (parts.slice(1).some(e => !e.problem.textContinuation)) throw Error('Missing continuation');
          return parts.length;
        };
        const fragments = runtimes.map(check);
        const stress = [
          { ...runtimes[0], textStructure: { questionText: '긴 선지', bodyText: 'Start.', choices: [{ text: 'A very long choice with [[u:underlined words]] and [[blank]]. '.repeat(180) }, { text: 'Second choice remains second.' }] } },
          { ...runtimes[0], textStructure: { questionText: '긴 한국어', bodyText: '가나다라마바사아자차카타파하'.repeat(300) } },
          { ...runtimes[0], problemType: '선택어법', textStructure: { bodyText: 'They [[box:A:is|are]] ready and [[u:learn together]]. '.repeat(170) } },
          { ...runtimes[0], textStructure: null, promptText: '다음 글을 읽고 답하시오. Legacy text stays complete. '.repeat(150) },
          { ...runtimes[0], kind: 'shared', textStructure: { bodyText: 'Shared reading passage. '.repeat(250) } }
        ].map(check);
        return { html: preview.html, rendered: preview.renderedQuestionCount, fragments, stress };
      }, fixtures);
      assert.equal(result.rendered, 3);
      assert.ok(result.fragments[0] > 1 && result.fragments[1] > 1);
      assert.equal(result.fragments[2], 1);
      assert.ok(result.stress.every(n => n > 1));
      // Show precisely the standalone document that would be sent to print.
      await page.setContent(result.html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: 'print' });
      const geometry = await page.evaluate(() => ({
        cards: document.querySelectorAll('.problem-card').length,
        pages: document.querySelectorAll('.sheet').length,
        answers: document.querySelectorAll('.answer-key-card').length,
        continuation: document.querySelectorAll('.problem-continuation-badge').length,
        overflow: [...document.querySelectorAll('.problem-card')].filter(card => card.getBoundingClientRect().bottom > card.closest('.sheet-column').getBoundingClientRect().bottom + 1).length,
        horizontalOverflow: [...document.querySelectorAll('.solbook-stem,.solbook-body,.solbook-choice-text')].filter(n => n.scrollWidth > n.clientWidth + 2).length,
        bodyFont: getComputedStyle(document.querySelector('.solbook-body')).fontSize,
        rawMarkers: /\[\[(?:u:|blank|box:)/.test(document.body.textContent),
      }));
      assert.equal(geometry.overflow, 0);
      assert.equal(geometry.horizontalOverflow, 0);
      assert.equal(geometry.answers, 3, 'Answer key must not count fragments as questions');
      assert.equal(geometry.rawMarkers, false);
      assert.deepEqual(errors, []);
      await page.pdf({ path: path.join(out, app + '.pdf'), preferCSSPageSize: true, printBackground: true });
      console.log(JSON.stringify({ app, fragments: result.fragments, stress: result.stress, geometry, errors }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
