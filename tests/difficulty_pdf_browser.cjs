// Real batch download on an isolated origin. All external traffic is blocked.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.PDFLAB_NODE_MODULES || 'playwright', process.env.PDFLAB_NODE_MODULES ? 'playwright' : ''));
const JSZip = require('../app/vendor/jszip/jszip.min.js');
const root = path.resolve(__dirname, '..'), origin = 'http://difficulty-pdf.test';
const out = path.join(root, 'tmp/difficulty-pdf-20261114');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (/firebase.*config/i.test(url.pathname)) return route.fulfill({ body: '/* isolated */', contentType: 'text/javascript' });
      const file = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream' });
    });
    const page = await context.newPage(), errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
    await page.goto(origin + '/app/index.html?workspace=exam');
    await page.waitForFunction(() => document.body.dataset.dataReady === 'true');
    const plans = await page.evaluate(async () => {
      const entries = ['A', 'B'].map(passage => ({ name: passage + '.json', payload:
        ['topic', 'factual', 'unfactual', 'insertion'].flatMap(type => (type === 'insertion' ? [null] : ['easy', 'medium', 'hard']).flatMap(difficulty =>
          [1, 2, 3].map(round => ({ type, difficulty, stem: 'Choose the correct answer.', body: type === 'insertion' ? `[주어진 문장] ${passage} This sentence belongs here. [본문] Opening. [[s]] Next. [[slot]] Last.` : `${passage} ${difficulty || 'COMMON'} ${type} ROUND ${round}. The printed paper must preserve its original two-column layout.`,
            answer: '①', explanation: type === 'insertion' && passage === 'A' ? '긴 해설 줄바꿈과 페이지 넘김 확인입니다. '.repeat(650) + 'END_OF_LONG_EXPLANATION' : '정답 1번의 합성 해설입니다.', choices: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'] })))) }));
      const problems = prepareAiProblemJsonBatch(entries, 'QA Book', 'neoreunteo', 'rounds');
      const source = { sourceId: 'qa', librarySourceKey: 'neoreunteo', textbookName: 'QA Book', fileName: 'qa.json', importedAt: 1 };
      state.libraryCache.problemRecords = await Promise.all(problems.map(p => serializeProblemForLibrary(p, source)));
      const records = state.libraryCache.problemRecords;
      state.schoolWorkflow.schools = [{ key: 'qa', name: 'QA', source: 'local' }];
      state.schoolWorkflow.selectedSchoolKey = 'qa';
      state.examBuilder.slots = records.filter(r => r.retryRound === 1).map((r, i) => createSchoolDraftSlotFromRecord(r, i + 1));
      elements.examTitleInput.value = '난이도별 일괄 출력 검증';
      renderExamSlots();
      window.beforeBatch = JSON.stringify({ slots: state.examBuilder.slots, retry: state.studentRetry, checks: state.libraryCache.checkSetRecords, history: state.libraryCache.examSets });
      return buildDifficultyPdfPlans().plans.map(p => ({ label: p.label, count: p.questionCount, ids: p.entries.filter(e => e.record.kind === 'problem').map(e => e.record.recordId) }));
    });
    assert.deepEqual(plans.map(p => p.count), [2, 8, 8, 8]);
    await page.addScriptTag({ url: origin + '/app/vendor/html2canvas/html2canvas.min.js' });
    await page.evaluate(() => {
      const capture = window.html2canvas;
      window.answerTextCaptured = [];
      window.html2canvas = async (element, options) => {
        if (/\[(?:주어진 문장|본문)\]/.test(element.textContent)) throw new Error('Authoring labels leaked into batch PDF');
        if (element.classList.contains('pdf-batch-answer-page')) {
          const columns = Array.from(element.querySelectorAll('.pdf-batch-answer-column'));
          if (columns.some(column => column.scrollHeight > column.clientHeight + 1)) throw new Error('Clipped answer column');
          window.answerTextCaptured.push(columns.map(column => column.textContent).join(''));
        }
        return capture(element, options);
      };
    });
    const downloadEvent = page.waitForEvent('download', { timeout: 240000 });
    await page.locator('#downloadDifficultyPdfsButton').click();
    const download = await downloadEvent;
    const archive = path.join(out, 'difficulty-papers.zip');
    await download.saveAs(archive);
    const zip = await JSZip.loadAsync(fs.readFileSync(archive));
    const files = Object.keys(zip.files);
    assert.equal(files.length, 8);
    for (const name of files) {
      const bytes = await zip.file(name).async('nodebuffer');
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      fs.writeFileSync(path.join(out, name), bytes);
    }
    await page.waitForFunction(() => !state.isBusy);
    assert.equal(await page.evaluate(() => JSON.stringify({ slots: state.examBuilder.slots, retry: state.studentRetry, checks: state.libraryCache.checkSetRecords, history: state.libraryCache.examSets }) === beforeBatch), true);
    assert.equal(await page.locator('iframe[title="난이도별 PDF 출력 준비"]').count(), 0);
    assert.equal(await page.evaluate(() => state.examBuilder.batchPdfUrls.length), 0);
    assert.match(await page.locator('#difficultyPdfFeedback').innerText(), /8개 PDF/);
    const capturedText = await page.evaluate(() => answerTextCaptured.join(''));
    assert.equal(capturedText.split('END_OF_LONG_EXPLANATION').length - 1, 4, 'every long explanation reaches its final text');
    assert.equal(capturedText.split('긴 해설 줄바꿈과 페이지 넘김 확인입니다. ').length - 1, 650 * 4, 'no text lost or duplicated across answer page breaks');
    await page.locator('#examCheckSetSection').screenshot({ path: path.join(out, 'download-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.locator('#examCheckSetSection').screenshot({ path: path.join(out, 'download-mobile.png') });
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 750;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,600,750);
      ctx.fillStyle = 'black'; ctx.font = '30px sans-serif'; ctx.fillText('IMAGE QUESTION', 20, 60);
      const image = await new Promise(resolve => canvas.toBlob(resolve));
      state.libraryCache.problemRecords = [{ recordId: 'image', sourceId: 'images', number: 1, kind: 'problem', retryMode: 'general', problemType: '독해',
        answerText: '①', explanationText: '이미지 합성 해설', segmentBlobs: [image], segmentMeta: [{x0:0,x1:600,y0:0,y1:750}] }];
      state.examBuilder.slots = [createSchoolDraftSlotFromRecord(state.libraryCache.problemRecords[0],1)];
      hydrateProblemRecordsWithAssets = async rows => rows;
      const settings = readExamExportSettings;
      readExamExportSettings = () => ({...settings(),contentRenderMode:'image'});
      renderExamSlots();
    });
    const imageDownloadEvent = page.waitForEvent('download', {timeout:120000});
    await page.locator('#downloadDifficultyPdfsButton').click();
    const imageDownload = await imageDownloadEvent;
    await imageDownload.saveAs(path.join(out, 'image-papers.zip'));
    const imageZip = await JSZip.loadAsync(fs.readFileSync(path.join(out,'image-papers.zip')));
    assert.equal(Object.keys(imageZip.files).length,2,'ordinary image JSON exports once as common');
    fs.mkdirSync(path.join(out,'image'),{recursive:true});
    for(const name of Object.keys(imageZip.files)) fs.writeFileSync(path.join(out,'image',name),await imageZip.file(name).async('nodebuffer'));
    await page.waitForFunction(() => !state.isBusy);
    // Rendering failure must restore controls and leave no frame or asset URLs.
    await page.evaluate(async () => {
      window.html2canvas = async () => { throw new Error('synthetic export failure'); };
      await downloadDifficultyPdfs().catch(() => {});
    });
    assert.match(await page.locator('#difficultyPdfFeedback').innerText(), /PDF 저장에 실패/);
    assert.equal(await page.locator('#downloadDifficultyPdfsButton').isEnabled(), true);
    assert.equal(await page.locator('iframe[title="난이도별 PDF 출력 준비"]').count(),0);
    assert.equal(await page.evaluate(() => state.examBuilder.batchPdfUrls.length),0);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ plans, files, errors, missing, productionAccess: false }, null, 2));
    console.log('PASS: 8 actual A4 PDFs in one ZIP, common/level counts, long explanation pagination, no draft/CHECK/history changes, desktop/mobile, no browser errors or missing files');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
