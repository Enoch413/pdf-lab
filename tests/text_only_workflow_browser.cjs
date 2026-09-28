// Fresh browser storage and an offline origin: never touches user data or Firebase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PDFLAB_NODE_MODULES ? path.join(process.env.PDFLAB_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..'), origin = 'http://text-workflow.test';
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json'), 'utf8'));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const screen of ['index', 'final_test', 'general_exam']) {
      const context = await browser.newContext();
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== origin) return route.abort();
        if (/firebase.*config/i.test(u.pathname)) return route.fulfill({ body: '/* offline */', contentType: 'text/javascript' });
        const file = path.resolve(root, '.' + decodeURIComponent(u.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/app/' + screen + '.html?workspace=exam');
      await page.waitForFunction(() => document.body.dataset.appReady === 'true');
      const result = await page.evaluate(async ({ fixture, screen }) => {
        const check = (condition, name) => { if (!condition) throw Error(name); };
        check(!document.getElementById('examContentModeSelect'), 'image selection still visible');
        check(!document.getElementById('schoolSourceFilterSelect'), 'source partition still visible');
        check(getSelectedLibrarySourceKey() === 'unspecified', 'new import requires source');
        state.schoolWorkflow.sourceFilterKey = 'thelab4you';
        check(getSchoolSourceFilterKey() === 'all', 'restored source restricts workflow');
        if (typeof applyExamContentModeToUi === 'function') applyExamContentModeToUi('image');
        check(readExamExportSettings().contentRenderMode === 'text', 'restored image mode wins');
        const records = fixture.problems.map((p, i) => PDFLabCanonical.create(p, fixture, 'offline-doc', 'fixture.json', {
          id: 'p' + i, recordId: 'p' + i, sourceId: 'offline-doc', kind: 'problem',
          librarySourceKey: i % 2 ? 'thelab4you' : 'neoreunteo', textbookName: 'QA 교재', textOnly: true
        }));
        state.libraryCache.problemRecords = records;
        state.libraryCache.imports = [
          { sourceId: 'a', librarySourceKey: 'neoreunteo', textbookName: 'QA 교재' },
          { sourceId: 'b', librarySourceKey: 'thelab4you', textbookName: '다른 교재' }
        ];
        state.schoolWorkflow.selectedSchoolKey = 'qa';
        state.libraryCache.examSets = [
          { examId: 'ea', schoolKey: 'qa', librarySourceKey: 'neoreunteo' },
          { examId: 'eb', schoolKey: 'qa', librarySourceKey: 'thelab4you' },
          { examId: 'ec', schoolKey: 'other', librarySourceKey: 'thelab4you' }
        ];
        state.libraryCache.examItems = [
          { examId: 'ea', problemRecordId: 'p0', librarySourceKey: 'neoreunteo' },
          { examId: 'eb', problemRecordId: 'p1', librarySourceKey: 'thelab4you' },
          { examId: 'ec', problemRecordId: 'p2', librarySourceKey: 'thelab4you' }
        ];
        check(getSchoolProblemRecordsOnly().length === 7, 'mixed sources hidden');
        check(getExamSetsForSelectedSchool().length === 2, 'mixed history missing or school filter lost');
        check(getSchoolUsedProblemIds().has('p0') && getSchoolUsedProblemIds().has('p1') && !getSchoolUsedProblemIds().has('p2'), 'used question exclusion lost');
        if (screen === 'index') {
          state.libraryReview.storedSourceKey = 'neoreunteo';
          check(getStoredLibraryReviewPayload().records.length === 7, 'stored manager still partitions sources');
          check(getStoredLibraryTextbookOptions().length === 2, 'stored textbooks filtered');
          state.libraryCache.checkSetRecords = state.libraryCache.examSets;
          check(getCheckSetRecordsForSelectedSchool().length === 2, 'CHECK source history lost');
        }
        state.libraryCache.savedWorks = [{ workId: 'old-image', kind: 'exam', name: 'Old image draft', payload: {
          contentRenderMode: 'image', schoolWorkflow: { sourceFilterKey: 'neoreunteo' },
          slots: [{ id: 'restored', category: 'objective', assignedProblemId: records[0].recordId }]
        } }];
        const savedBefore = JSON.stringify(state.libraryCache.savedWorks);
        await loadSavedWork('old-image');
        check(readExamExportSettings().contentRenderMode === 'text', 'saved image draft not converted for output');
        check(state.examBuilder.slots[0].assignedProblemId === records[0].recordId, 'restored selection changed');
        check(savedBefore === JSON.stringify(state.libraryCache.savedWorks), 'saved draft overwritten on load');
        hydrateProblemRecordsWithAssets = async () => { throw Error('text mode requested image assets'); };
        getExamSlotAssignedRecords = () => records.map(record => ({ record }));
        const before = JSON.stringify(records);
        const payload = await buildExamProblemPayloadFromSlots();
        check(payload.problems.every(p => p.renderContentMode === 'text'), 'not all text runtime');
        const rendered = await buildExamPreviewDocument();
        check(rendered.renderedQuestionCount === 7, 'selected question count changed');
        check(!rendered.html.includes('canonical-group-reference'), 'internal group identity exposed');
        check(before === JSON.stringify(records), 'source records modified');
        // Legacy text + image records render their text without downloading blobs.
        const legacy = { recordId: 'legacy', kind: 'problem', number: 8, problemType: '내용',
          textStructure: { questionText: 'LEGACY QUESTION', bodyText: 'LEGACY BODY', choices: ['one', 'two'] },
          segmentStoragePaths: ['preserved/image.png'], answerText: '①' };
        const legacyBefore = JSON.stringify(legacy);
        const legacyRuntime = createExamRuntimeProblemFromRecord(legacy, 1);
        check(buildProblemTextMarkup(legacyRuntime).includes('LEGACY BODY'), 'legacy text missing');
        check(legacyBefore === JSON.stringify(legacy), 'legacy assets changed');
        const rawLegacy = createExamRuntimeProblemFromRecord({ ...legacy, textStructure: {}, analysisText: 'LEGACY RAW BODY' }, 1);
        check(buildProblemTextMarkup(rawLegacy).includes('LEGACY RAW BODY'), 'legacy raw text missing');
        let missing = '';
        try { createExamRuntimeProblemFromRecord({ recordId: 'image-only', kind: 'problem', number: 9, segmentStoragePaths: ['keep.png'] }, 1); }
        catch (e) { missing = e.message; }
        check(missing.includes('AI JSON'), 'image-only record silently printed blank');
        // Actual preview button uses real settings (no render-mode override).
        state.examBuilder.slots = [{ slotId: 'qa-slot', assignedProblemId: 'p0' }];
        return { questions: payload.renderedQuestionCount, mode: readExamExportSettings().contentRenderMode };
      }, { fixture, screen });
      assert.equal(result.mode, 'text');
      const popupReady = page.waitForEvent('popup');
      await page.evaluate(() => previewExamLayout());
      const popup = await popupReady;
      await popup.waitForLoadState();
      await popup.waitForSelector('.problem-card');
      assert.equal(popup.isClosed(), false);
      assert.match(await popup.locator('body').innerText(), /다음 글을 읽고 물음에 답하시오/);
      await popup.close();
      {
        await page.evaluate(() => { getExamSlotAssignedRecords = () => [{ record: { recordId: 'image-only', kind: 'problem', number: 9 } }]; });
        const errorPopupReady = page.waitForEvent('popup');
        const message = await page.evaluate(() => previewExamLayout().then(() => '', e => e.message));
        const errorPopup = await errorPopupReady;
        assert.match(message, /AI JSON/);
        assert.equal(errorPopup.isClosed(), false);
        assert.match(await errorPopup.locator('body').innerText(), /AI JSON/);
      }
      assert.deepEqual(errors, []);
      console.log('PASS ' + screen + ': text default/restore, mixed sources/history, legacy text/assets, real popup, missing-text warning');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
