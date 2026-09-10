// Isolated headless QA: no user profile, live Firebase, or network requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PDFLAB_NODE_MODULES
  ? path.join(process.env.PDFLAB_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tmp/pdfs/json-only-qa');
const origin = 'http://pdflab-test.local';
const fixture = { questions: [
  { number: 101, type: 'title', stem: '다음 글의 제목으로 가장 적절한 것은?', body: 'Small acts of kindness can change a community. People learn to trust each other through daily cooperation.', choices: ['The Value of Kindness', 'A Lonely Journey', 'The Cost of Travel', 'Rules of Science', 'Modern Machines'], answer: '1', explanation: '친절과 협력의 가치를 설명한다.', passageLabel: '2학기-01' },
  { number: 102, type: '빈칸', stem: '다음 빈칸에 들어갈 말로 가장 적절한 것은?', body: 'We build trust through [[blank]].', choices: ['cooperation', 'silence', 'fear', 'distance', 'luck'], answer: '1', passageLabel: '2학기-01' },
  { number: 103, type: '순서', questionText: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?', givenText: 'A student started a garden.', body: '(A) The flowers finally bloomed.\n\n(B) She planted the seeds.\n\n(C) She watered them every day.', choices: ['B-C-A', 'A-B-C', 'C-A-B', 'B-A-C', 'A-C-B'], answer: '1', passageLabel: '2학기-02' },
  { number: 104, type: '삽입', stem: '주어진 문장이 들어가기에 가장 적절한 곳은?', givenText: 'However, things soon changed.', body: 'The street was quiet. [[s]] A festival began. [[s]] Music filled the air. [[s]]', answer: '1', passageLabel: '2학기-03' },
  { number: 105, type: '영작', isSubjective: true, stem: '다음 우리말을 영어로 쓰시오.', body: '우리는 함께 배운다.\n\n[[blank]]', answer: 'We learn together.', explanation: '주어와 동사의 일치에 유의한다.', passageLabel: '2학기-04' },
  { number: 106, type: '요약', textStructure: { questionText: '글을 요약한 문장의 빈칸에 들어갈 말로 가장 적절한 것은?', bodyText: 'Practice improves skill, and patience helps people continue.', summaryText: 'We need [[blank:A]] and [[blank:B]].', choices: [{ text: 'practice / patience' }, { text: 'speed / silence' }, { text: 'fear / anger' }, { text: 'money / luck' }, { text: 'rest / noise' }] }, answer: '1', passageLabel: '2학기-05' }
] };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let previewHtml = '';
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/qa-preview.html') return route.fulfill({ body: previewHtml, contentType: 'text/html; charset=utf-8' });
      const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (![path.join(root, 'app'), path.join(root, 'dist/solbook_question_maker_portable')].some(dir => target.startsWith(dir + path.sep))) return route.abort();
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return route.fulfill({ status: 404, body: '' });
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' };
      return route.fulfill({ body: fs.readFileSync(target), contentType: mime[path.extname(target)] || 'application/octet-stream' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/app/index.html?workspace=library');
    await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    assert.equal(await page.locator('#chooseProblemJsonButton').isEnabled(), true);
    // Validation is atomic and leaves the empty import unchanged.
    const validation = await page.evaluate(fixture => {
      const messages = [];
      const invalid = [{}, [], [null], [{ number: -1, body: 'Bad' }], [{ number: 1.5, body: 'Bad' }], [{ number: 0, body: 'Bad' }], [{ number: 1, body: 'First' }, { number: 1, body: 'Second' }], [{ number: 1 }]];
      try { applyAiProblemJsonPayload(fixture, 'unit.json'); } catch (error) { messages.push(error.message); }
      elements.newTextbookInput.value = 'JSON 전용 QA 교재';
      for (const payload of invalid) {
        try { applyAiProblemJsonPayload(payload, 'bad.json'); messages.push('NOT REJECTED'); }
        catch (error) { messages.push(error.message); }
        if (state.problems.length || state.fileName) throw new Error('Invalid import changed state');
      }
      const automatic = createTextProblemsFromAiJsonItems([{ type: 'title', stem: 'Choose.', text: 'Body kept.' }, { type: '빈칸', body: 'Second.' }], 'Book', 'neoreunteo', 'numberless.json');
      const largeNumber = createTextProblemsFromAiJsonItems([{ number: 1001, body: 'Large number.' }], 'Book', 'neoreunteo', 'large.json');
      const letterAnswer = createTextProblemsFromAiJsonItems([{ type: '주관식', stem: '첫 글자를 쓰시오.', answer: 'A', explanation: 'Because this is a letter.' }], 'Book', 'neoreunteo', 'letter.json')[0];
      repairOcrStolenInitialAnswerFields(letterAnswer);
      const wrappers = ['problems', 'items', 'questions', 'data', '문항', '문제'].every(key => extractAiProblemJsonItems({ [key]: fixture.questions }).length === 6);
      return { messages, automatic: automatic.map(p => p.number), body: automatic[0].textStructure.bodyText, type: automatic[0].problemType, largeNumber: largeNumber[0].number, letterAnswer: normalizeParsedAnswerTextForProblem(letterAnswer, letterAnswer.answerText), wrappers };
    }, fixture);
    assert.equal(validation.messages.length, 9);
    assert.equal(validation.messages.includes('NOT REJECTED'), false);
    assert.match(validation.messages[0], /교재/);
    assert.deepEqual(validation.automatic, [1, 2]);
    assert.equal(validation.body, 'Body kept.');
    assert.equal(validation.type, '제목');
    assert.equal(validation.largeNumber, 1001);
    assert.equal(validation.letterAnswer, 'A');
    assert.equal(validation.wrappers, true);
    await page.locator('#problemJsonInput').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
    await page.waitForFunction(() => !state.isBusy && elements.statusCopy.textContent.includes('JSON 파일 형식'));
    // Real file-input event, including UTF-8 BOM, with no PDF loaded.
    await page.locator('#problemJsonInput').setInputFiles({ name: 'semester-two.json', mimeType: 'application/json', buffer: Buffer.from('\uFEFF' + JSON.stringify(fixture)) });
    await page.waitForFunction(() => !state.isBusy && state.problems.length === 6);
    assert.equal(await page.locator('#clearButton').isEnabled(), true);
    assert.match(await page.locator('#problemJsonSummary').textContent(), /PDF 없이/);
    await page.locator('#repackTabPanel .panel-card').first().screenshot({ path: path.join(out, 'import-controls.png') });
    const saved = await page.evaluate(async () => {
      if (state.pdfDoc !== null || state.pages.length) throw new Error('PDF required unexpectedly');
      if (getSelectedExamContentMode() !== 'text') throw new Error('Text mode was not selected');
      const original = JSON.stringify(state.problems);
      const remote = new Map();
      // Use real Firebase serialization/sync logic with an in-memory SDK boundary.
      getSharedFirebaseLibraryAccessState = () => ({ enabled: true });
      loadSharedLibraryProblemDocsBySourceId = async () => [];
      state.firebaseSchoolBridge.storage = { ref: () => { throw new Error('Unexpected image upload'); } };
      state.firebaseSchoolBridge.db = { collection: name => ({ doc: id => ({
        set: async (value, options) => {
          const key = name + '/' + id;
          remote.set(key, { ...(options?.merge ? remote.get(key) || {} : {}), ...structuredClone(value) });
        },
        get: async () => ({ exists: false, data: () => null }),
        delete: async () => { throw new Error('Unexpected delete'); }
      }) }) };
      ensureExplicitLibrarySaveTargetsReady = async () => {};
      syncSelectedLibraryDestinations = async (source, records, options) => ({
        mode: 'firebase',
        firebase: options.skipFirebase ? { attempted: false } : { attempted: true, ...await syncSourceRecordToSharedFirebaseLibrary(source, records) },
        folder: { attempted: false, synced: false }
      });
      await saveProblemsToLibrary();
      const records = await loadAllRecordsFromStore(LIBRARY_PROBLEM_STORE);
      const imports = await loadAllRecordsFromStore(LIBRARY_IMPORT_STORE);
      const metadataResult = await saveProblemMetadataRecordsToSharedFirebaseLibrary(records, imports);
      if (!metadataResult.synced) throw new Error(metadataResult.reason);
      const snapshot = await serializeProblemForSavedWork(state.problems[4]);
      const restored = hydrateProblemFromSavedWork(snapshot);
      let legacyGuard = false;
      try { validateSharedLibraryImageUpload({ kind: 'problem', number: 1, contentMode: 'text' }, { segmentBlobs: [] }); }
      catch (error) { legacyGuard = error.message.includes('이미지 블록'); }
      let partialUploadGuard = false;
      try { validateSharedLibraryImageUpload(records[0], { segmentBlobs: [new Blob(['image'])] }, []); }
      catch (error) { partialUploadGuard = true; }
      return { records, imports, remote: [...remote.values()], restored, originalUnchanged: JSON.stringify(state.problems) === original, legacyGuard, partialUploadGuard };
    });
    assert.equal(saved.records.length, 6);
    assert.equal(saved.imports[0].fileName, 'semester-two.json');
    assert.equal(saved.imports[0].contentMode, 'text');
    assert.equal(saved.remote.length, 7);
    assert.equal(saved.records.every(r => r.textOnly && r.contentMode === 'text' && r.segmentMeta.length === 0), true);
    assert.equal(saved.remote.filter(r => r.kind === 'problem').every(r => r.segmentStoragePaths.length === 0), true);
    assert.equal(saved.restored.isSubjective, true);
    assert.equal(saved.restored.problemType, '주관식');
    assert.equal(saved.restored.subjectiveType, '영작');
    assert.equal(saved.restored.textOnly, true);
    assert.equal(saved.legacyGuard, true);
    assert.equal(saved.partialUploadGuard, true);
    assert.equal(saved.originalUnchanged, true);
    // Reload reads the saved JSON-only records from IndexedDB, with no SDK.
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    const reloaded = await page.evaluate(() => state.libraryCache.problemRecords);
    assert.equal(reloaded.length, 6);
    assert.equal(reloaded.every(r => r.textOnly), true);
    // Preserve the established PDF + JSON overlay route and all image references.
    const overlay = await page.evaluate(() => {
      const images = [{ url: 'data:image/png;base64,test', width: 100, height: 200 }];
      const segments = [{ pageIndex: 0, x0: 0, x1: 100, y0: 0, y1: 200 }];
      state.problems = [{ id: 'problem-7', kind: 'problem', number: 7, worksheetFamily: 'PDF Book', segments, segmentImages: images, answerSegments: [], answerSegmentImages: [], promptText: 'Old text', contentMode: 'image' }];
      state.fileName = 'existing.pdf';
      state.selectedTextbookName = 'PDF Book';
      applyAiProblemJsonPayload({ items: [{ number: 7, type: '주제', stem: 'New question', body: 'New passage', answer: '2' }, { number: 99, body: 'Unmatched' }] }, 'overlay.json');
      const result = { count: state.problems.length, imagesKept: state.problems[0].segmentImages === images && state.problems[0].segments === segments, textOnly: Boolean(state.problems[0].textOnly), fileName: state.fileName, answer: state.problems[0].answerText, summary: elements.problemJsonSummary.textContent };
      clearAll();
      return { ...result, uploadEnabled: !elements.chooseProblemJsonButton.disabled };
    });
    assert.equal(overlay.count, 1);
    assert.equal(overlay.imagesKept, true);
    assert.equal(overlay.textOnly, false);
    assert.equal(overlay.fileName, 'existing.pdf');
    assert.equal(overlay.answer, '②');
    assert.match(overlay.summary, /매칭 실패 1개/);
    assert.equal(overlay.uploadEnabled, true);
    const geometryResults = [];
    // Both exam entry points render the persisted records, not the input JSON.
    for (const name of ['index', 'final_test']) {
      await page.goto(origin + '/app/' + name + '.html?workspace=exam');
      await page.waitForFunction(() => typeof buildExamPreviewDocument === 'function' && !!window.PDFLabSolbookText);
      const preview = await page.evaluate(async records => {
        const settings = { ...readExamExportSettings(), title: 'JSON 전용 텍스트 출제 QA', subtitle: 'PDF 없이 등록한 6문항', logoSrc: '', contentRenderMode: 'text', includeAnswerKey: true };
        readExamExportSettings = () => settings;
        getExamSlotAssignedRecords = () => records.map(record => ({ record }));
        hydrateProblemRecordsWithAssets = async () => { throw new Error('Text exam tried to download images'); };
        let imageModeGuard = false;
        try { createExamRuntimeProblemFromRecord(records[0], 1, 'previewUrls', 'image'); }
        catch (error) { imageModeGuard = error.message.includes('텍스트 전용'); }
        if (!imageModeGuard) throw new Error('Missing text-only mode guidance');
        return await buildExamPreviewDocument('previewUrls');
      }, reloaded);
      assert.equal(preview.renderedQuestionCount, 6);
      previewHtml = preview.html;
      await page.goto(origin + '/qa-preview.html');
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        count: document.querySelectorAll('.problem-card').length,
        sheets: document.querySelectorAll('.sheet').length,
        rawMarkers: /\[\[(?:blank|u:|box:|s\]\])/.test(document.body.textContent),
        overflow: [...document.querySelectorAll('.problem-card')].some(card => card.getBoundingClientRect().bottom > card.closest('.sheet').getBoundingClientRect().bottom - 8),
        textOverflow: [...document.querySelectorAll('.solbook-stem,.solbook-body,.solbook-choice-text')].some(el => el.scrollWidth > el.clientWidth + 2),
        text: document.body.textContent
      }));
      assert.equal(geometry.count, 6);
      assert.equal(geometry.rawMarkers, false);
      assert.equal(geometry.overflow, false);
      assert.equal(geometry.textOverflow, false);
      assert.match(geometry.text, /We learn together/);
      await page.pdf({ path: path.join(out, name + '.pdf'), preferCSSPageSize: true, printBackground: true });
      geometryResults.push({ name, ...geometry, text: undefined });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', validationCases: validation.messages.length, savedQuestions: saved.records.length, firebaseMockRecords: saved.remote.length, reload: reloaded.length, overlay, previews: geometryResults }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
