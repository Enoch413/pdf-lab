// Isolated QA: never opens the user's browser or contacts Firebase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PDFLAB_NODE_MODULES ? path.join(process.env.PDFLAB_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const makerPath = 'dist/solbook_question_maker_portable/app/solbook_question_maker.html';
const origin = 'http://solbook-export.test';
const out = path.join(root, 'tmp/pdfs/solbook-export-qa');
const body = 'A small library gives students a place to share ideas. When students explain a book to their friends, they discover new ways of understanding the story. Some people prefer to read alone, while others learn more through discussion. Both approaches can help readers think carefully about what they have read.';
const sources = ['Passage A.json', 'Passage B.json'].map((sourceName, sourceOrder) => ({ sourceName, sourceOrder,
  rows: ['주제', '제목', '내용일치'].flatMap(type => ['쉬움', '어려움'].flatMap(difficulty => [1, 2, 3].map(round => ({
    type, difficulty,
    stem: `다음 글의 ${type === '내용일치' ? '내용과 일치하는 것을' : type + '로 가장 적절한 것을'} 고르시오.`,
    body: `${body}\n\n${difficulty === '어려움' ? 'EXCLUDED_HARD' : 'INCLUDED_EASY'} passage ${sourceOrder + 1}, round ${round}.`,
    choices: ['The value of sharing ideas about books', 'The need to avoid reading with friends', 'A new method of building a library', 'The history of books in a small town', 'The disadvantages of learning at school'],
    answer: '1', explanation: `서로 생각을 나누며 글을 더 깊이 이해한다는 내용이므로 정답은 ①입니다. ${sourceName} ${round}차`
  })))) }));
const selectedRaw = sources.flatMap(source => source.rows.filter(q => q.type !== '내용일치' && q.difficulty === '쉬움'));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    async function createPage(baseline = false, fileMode = false) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
      const oldHtml = baseline ? execFileSync('git', ['show', 'HEAD:' + makerPath], { cwd: root, encoding: 'utf8' }) : null;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.protocol === 'file:') return route.continue();
        if (url.origin !== origin) return route.abort();
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' };
        return route.fulfill({ body: oldHtml && file === path.join(root, makerPath) ? oldHtml : fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(fileMode ? require('node:url').pathToFileURL(path.join(root, makerPath)).href : origin + '/' + makerPath);
      await page.waitForFunction(() => typeof loadQuestionsFromPayload === 'function');
      return { context, page, errors };
    }

    // Save a reproducible pre-change comparison from the committed maker.
    if (process.argv.includes('--baseline')) {
      const { context, page } = await createPage(true);
      const b64 = await page.evaluate(async rows => {
        loadQuestionsFromPayload(rows, 'Print readability QA.json');
        const blob = await createDirectPdfBlobForPlan({ title: '인쇄 가독성 비교', subtitle: '주제·제목 · 쉬움 · 12문항', questions: getFilteredQuestions(), includeAnswers: true });
        return arrayBufferToBase64(await blob.arrayBuffer());
      }, selectedRaw);
      fs.writeFileSync(path.join(out, 'before.pdf'), Buffer.from(b64, 'base64'));
      await context.close();
    }

    const { context, page, errors } = await createPage();
    // Exercise the real multi-file upload handler, including Korean type/difficulty aliases.
    await page.locator('#jsonFileInput').setInputFiles(sources.map(s => ({ name: s.sourceName, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(s.rows)) })));
    await page.waitForFunction(() => state.questions.length === 36 && state.filtered.length === 36);
    const initialSnapshot = await page.evaluate(() => JSON.stringify(state.questions));
    assert.equal(await page.locator('#typeFilterOptions input:checked').count(), 3);
    await page.locator('#clearTypesButton').click();
    assert.equal(await page.locator('#printButton').isDisabled(), true);
    assert.equal(await page.locator('#batchZipButton').isDisabled(), true);
    await page.locator('#typeFilterOptions input[value="topic"]').check();
    await page.locator('#typeFilterOptions input[value="title"]').check();
    await page.locator('#difficultySelect').selectOption('easy');
    await page.waitForFunction(() => state.filtered.length === 12);
    assert.match(await page.locator('#selectionSummary').innerText(), /12 \/ 전체 36/);
    const filtered = await page.evaluate(() => ({ ids: state.filtered.map(q => q.uniqueId),
      plans: buildBatchExamPlans().map(p => ({ filename: p.filename, ids: p.questions.map(q => q.uniqueId), types: p.questions.map(q => q.type), difficulties: p.questions.map(q => q.difficultyKey) })) }));
    assert.equal(filtered.plans.length, 3);
    assert.deepEqual(new Set(filtered.plans.flatMap(p => p.ids)), new Set(filtered.ids));
    assert.ok(filtered.plans.every(p => p.ids.length === 4 && p.types.every(t => ['topic', 'title'].includes(t)) && p.difficulties.every(d => d === 'easy')));
    await page.locator('#sortModeSelect').selectOption('type');
    await page.waitForFunction(() => state.sortMode === 'type');
    assert.deepEqual(await page.evaluate(() => state.filtered.map(q => q.type)), [...Array(6).fill('topic'), ...Array(6).fill('title')]);
    await page.locator('#sortModeSelect').selectOption('source');
    await page.locator('#includeAnswerInput').check();
    await page.waitForFunction(() => state.sortMode === 'source' && document.querySelectorAll('.answer-card').length === 12);
    // Count actual data handed to the renderer, then run its original implementation.
    await page.evaluate(() => {
      window.qaPlans = [];
      const original = createDirectPdfBlobForPlan;
      createDirectPdfBlobForPlan = async (plan, callback) => { window.qaPlans.push({ ids: plan.questions.map(q => q.uniqueId), includeAnswers: plan.includeAnswers }); return original(plan, callback); };
      elements.examTitleInput.value = '인쇄 가독성 비교';
    });
    const singleDownload = page.waitForEvent('download');
    await page.locator('#printButton').click();
    const single = await singleDownload;
    await single.saveAs(path.join(out, 'after.pdf'));
    await page.waitForFunction(() => !state.isSingleBusy);
    assert.match(single.suggestedFilename(), /쉬움/);
    assert.equal(await page.evaluate(() => qaPlans[0].ids.length), 12);
    const fontData = await page.evaluate(() => ({ separate: PDFLAB_PRINT_PDF_FONTS_BASE64.normal !== PDFLAB_PRINT_PDF_FONTS_BASE64.bold }));
    assert.equal(fontData.separate, true);
    const zipDownload = page.waitForEvent('download');
    await page.locator('#batchZipButton').click();
    const zip = await zipDownload;
    await zip.saveAs(path.join(out, 'selected.zip'));
    await page.waitForFunction(() => !state.isBatchBusy);
    assert.match(zip.suggestedFilename(), /3개_시험지.zip$/);
    const zipResult = await page.evaluate(async () => {
      const blob = await (await fetch(state.batchDownloadUrl)).blob();
      const archive = await JSZip.loadAsync(blob);
      return { files: Object.keys(archive.files), plans: qaPlans.slice(1) };
    });
    assert.equal(zipResult.files.length, 3);
    assert.equal(zipResult.plans.length, 3);
    assert.deepEqual(new Set(zipResult.plans.flatMap(p => p.ids)), new Set(filtered.ids));
    assert.equal(await page.evaluate(() => JSON.stringify(state.questions)), initialSnapshot);
    await page.screenshot({ path: path.join(out, 'controls.png') });
    await page.locator('#resetButton').click();
    await page.waitForFunction(() => state.filtered.length === 36);
    assert.equal(await page.locator('#typeFilterOptions input:checked').count(), 3);
    // Empty intersection, no unknown-type loss, no blank PDFs, and no 36-item export cap.
    const edges = await page.evaluate(() => {
      loadQuestionsFromPayload([{ type: 'topic', difficulty: 'easy', body: 'A' }, { type: 'title', difficulty: 'hard', body: 'B' }, { body: 'C', difficulty: 'special' }]);
      selectAllTypes(false);
      elements.typeFilterOptions.querySelector('input[value="topic"]').checked = true;
      elements.difficultySelect.value = 'hard'; renderExam();
      const empty = state.filtered.length === 0 && buildBatchExamPlans().length === 0 && elements.printButton.disabled && elements.batchZipButton.disabled;
      elements.difficultySelect.value = ''; selectAllTypes(true);
      const unknown = buildBatchExamPlans().some(p => p.questions.some(q => q.body === 'C'));
      loadQuestionsFromPayload(Array.from({ length: 360 }, (_, i) => ({ type: i % 2 ? 'topic' : 'title', difficulty: 'easy', stem: '대량 검증', body: 'Question ' + i })));
      return { empty, unknown, filtered: state.filtered.length, preview: elements.examRoot.querySelectorAll('.question-card').length };
    });
    assert.deepEqual(edges, { empty: true, unknown: true, filtered: 360, preview: 36 });
    const markerRows = require('./solbook_text_fixtures.cjs').map(record => ({ type: record.problemType,
      stem: record.textStructure.questionText,
      body: [record.textStructure.givenText, record.textStructure.bodyText, record.textStructure.summaryText].filter(Boolean).join('\n\n'),
      choices: record.textStructure.choices.map(c => c.text), answer: record.answerText, explanation: record.explanationText }));
    const markerLayout = await page.evaluate(async rows => {
      const pdf = new jspdf.jsPDF({ unit: 'mm' }); await registerDirectPdfFont(pdf);
      const questions = normalizeQuestionsFromPayload(rows);
      const layout = buildDirectQuestionPages(pdf, questions, 40);
      const width = layout.columnWidth - DIRECT_LAYOUT.card.padding * 2;
      let horizontalOverflow = 0;
      questions.forEach((q, i) => directQuestionBlocks(q, i + 1).forEach(block => {
        if (block.kind !== 'text') return;
        directLayoutTextLines(pdf, block.text, width, block.size, block).forEach(line => {
          if (getDirectWordsWidth(pdf, line.words || [], block.size, line.style) > width + 0.01) horizontalOverflow++;
        });
      }));
      const overflow = layout.pages.flatMap(p => p.columns.flat()).filter(item => item.y + item.height > 282.01).length;
      pdf.setFontSize(20.25);
      const longHeader = fitDirectHeaderLine(pdf, '아주 긴 제목 '.repeat(40), 160);
      return { questions: questions.length, horizontalOverflow, overflow, headerFits: pdf.getTextWidth(longHeader) <= 160.01 };
    }, markerRows);
    assert.deepEqual(markerLayout, { questions: 16, horizontalOverflow: 0, overflow: 0, headerFits: true });
    assert.deepEqual(errors, []);
    await context.close();

    // Portable file:// mode needs the bundled JS font, not fetch(CORS).
    const offline = await createPage(false, true);
    const offlineResult = await offline.page.evaluate(async () => {
      const pdf = new jspdf.jsPDF();
      await registerDirectPdfFont(pdf);
      return pdf.getFontList().NotoSansKR;
    });
    assert.deepEqual(offlineResult, ['normal', 'bold']);
    assert.deepEqual(offline.errors, []);
    await offline.context.close();
    console.log(JSON.stringify({ pass: true, selected: 12, total: 36, zipPdfs: 3, edges, markerLayout, offlineFonts: 2, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
