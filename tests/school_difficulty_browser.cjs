// Real controls and importer, isolated origin; all Firebase/network access blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PDFLAB_NODE_MODULES || '../node_modules', 'playwright'));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tmp/school-difficulty-20261030');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const origin = 'http://school-difficulty.test';
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
    await page.evaluate(async () => {
      const entries = ['A', 'B'].map(passage => ({ name: passage + '.json', payload:
        ['easy', 'medium', 'hard'].flatMap(difficulty => ['topic', 'title'].flatMap(type =>
          [1, 2, 3].map(round => ({ type, difficulty, stem: 'Choose.', body: `${passage} ${difficulty} ${type} ${round}`,
            answer: '①', choices: ['A', 'B', 'C', 'D', 'E'] })))) }));
      const problems = prepareAiProblemJsonBatch(entries, 'QA Book', 'neoreunteo', 'rounds');
      const source = { sourceId: 'qa', librarySourceKey: 'neoreunteo', textbookName: 'QA Book', fileName: 'qa.json', importedAt: 1 };
      state.libraryCache.problemRecords = await Promise.all(problems.map(p => serializeProblemForLibrary(p, source)));
      state.schoolWorkflow.schools = [{ key: 'qa', name: 'QA', source: 'local' }];
      state.schoolWorkflow.selectedSchoolKey = 'qa';
      state.schoolWorkflow.excludeUsedProblems = false;
      applySchoolWorkflowSnapshot(captureSchoolWorkflowSnapshot());
      renderExamLibraryList(); renderExamSlots();
    });
    const select = page.getByLabel('차수형 난이도', { exact: true });
    assert.equal(await select.isEnabled(), true, JSON.stringify(await page.evaluate(() => ({ busy: state.isBusy,
      source: getSchoolSourceFilterKey(), options: getSchoolDifficultyOptions(),
      records: state.libraryCache.problemRecords.slice(0, 1) }))));
    assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(o => o.value)), ['', 'easy', 'medium', 'hard']);
    await select.selectOption('easy');
    for (let index = 0; index < await page.locator('.school-passage-toggle').count(); index++) {
      await page.locator('.school-passage-toggle').nth(index).click();
    }
    await page.locator('#generateSchoolDraftButton').click();
    const assigned = () => page.evaluate(() => state.examBuilder.slots.map(slot =>
      state.libraryCache.problemRecords.find(record => record.recordId === slot.assignedProblemId)));
    let records = await assigned();
    assert.equal(records.length, 4);
    assert(records.every(r => r.difficulty === 'easy' && r.retryRound === 1));
    page.once('dialog', dialog => dialog.dismiss());
    await select.selectOption('hard');
    assert.equal(await select.inputValue(), 'easy');
    assert.deepEqual(await assigned(), records, 'cancel keeps existing draft');
    page.once('dialog', dialog => dialog.accept());
    await select.selectOption('hard');
    assert.equal((await assigned()).length, 0, 'confirmed change clears stale draft');
    await page.locator('#generateSchoolDraftButton').click();
    records = await assigned();
    assert(records.length === 4 && records.every(r => r.difficulty === 'hard' && r.retryRound === 1));
    assert.equal(await page.locator('#schoolDraftReview').evaluate(details => details.open), false);
    assert((await page.locator('#schoolDraftReviewSummary').textContent()).includes('4문항'));
    await page.locator('#schoolDraftReview > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#examSlotList .exam-slot-card').first().isVisible(), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#schoolDraftReview').evaluate(details => details.open), false);
    assert.equal(await page.evaluate(() => captureSchoolWorkflowSnapshot().difficultyFilter), 'hard');
    await page.evaluate(() => document.querySelector('#schoolDifficultySelect').closest('.panel-card').scrollIntoView());
    await page.screenshot({ path: path.join(out, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await select.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'mobile.png') });
    const size = await select.boundingBox();
    assert(size && size.width > 100 && size.x >= 0 && size.x + size.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const pairs = await page.evaluate(() => state.examBuilder.slots.map(slot => {
      const item = { problemRecordId: slot.assignedProblemId };
      const second = findNextRetryCandidateForItem(item, new Set());
      const third = findNextRetryCandidateForItem({ problemRecordId: second.recordId }, new Set());
      return [second.difficulty, second.retryRound, third.difficulty, third.retryRound];
    }));
    assert(pairs.every(pair => JSON.stringify(pair) === JSON.stringify(['hard', 2, 'hard', 3])));
    const preview = await page.evaluate(async () => {
      applyExamContentModeToUi('text');
      const output = await buildExamPreviewDocument('previewUrls');
      return { count: output.totalQuestionCount, markup: output.markup };
    });
    assert.equal(preview.count, 4);
    assert(preview.markup.includes('hard') && !preview.markup.includes('easy') && !preview.markup.includes('medium'),
      'actual export contains only the selected difficulty');
    // Two different first-round difficulties inside one session, through real UI.
    await page.evaluate(() => {
      state.studentRetry.students = ['One', 'Two'].map((name, index) => ({ studentId: 'qa-' + index, name, schoolKey: 'qa' }));
      renderStudentRetryPanel();
    });
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#startStudentRetryButton').click();
    await page.locator('#studentFirstRoundDifficultySelect').selectOption('easy');
    await page.locator('[data-student-first-difficulty]').click();
    await page.locator('#studentRetryStudentSelect').selectOption('qa-1');
    await page.locator('#studentFirstRoundDifficultySelect').selectOption('medium');
    await page.locator('[data-student-first-difficulty]').click();
    const firstRounds = await page.evaluate(() => {
      const session = getSelectedRetrySession();
      return { count: state.studentRetry.sessions.length, base: session.baseItems.map(item => item.difficulty),
        students: Object.values(session.studentStates).map(value => value.rounds[0].items.map(item => item.difficulty)) };
    });
    assert.equal(firstRounds.count, 1);
    assert(firstRounds.base.every(value => value === 'hard'));
    assert.deepEqual(firstRounds.students, [Array(4).fill('easy'), Array(4).fill('medium')]);
    await page.locator('#studentRetryStudentSelect').selectOption('qa-0');
    await page.locator('[data-student-first-load]').click();
    assert((await assigned()).every(record => record.difficulty === 'easy'));
    const personal = await page.evaluate(async () => {
      const output = await buildExamPreviewDocument('previewUrls');
      return { markup: output.markup, student: getCurrentStudentRetryDraftContext().studentId,
        targets: getCheckSetTargetStudentsForCurrentDraft().map(student => student.studentId) };
    });
    assert.equal(personal.student, 'qa-0');
    assert.deepEqual(personal.targets, ['qa-0']);
    assert(personal.markup.includes('easy') && !personal.markup.includes('medium') && !personal.markup.includes('hard'));
    await page.evaluate(() => {
      const first = getStudentRetryState(getSelectedRetrySession(), 'qa-0').rounds[0];
      updateStudentRetryResult('qa-0', 1, first.items[0].itemId, true);
    });
    assert.equal(await page.locator('#studentFirstRoundDifficultySelect').isDisabled(), true);
    await page.locator('#generateStudentRetryButton').click();
    await page.waitForFunction(() => getStudentRetryState(getSelectedRetrySession(), 'qa-0').rounds.length === 2);
    assert((await assigned()).length === 1 && (await assigned())[0].difficulty === 'easy' && (await assigned())[0].retryRound === 2);
    await page.evaluate(() => {
      const second = getStudentRetryState(getSelectedRetrySession(), 'qa-0').rounds[1];
      updateStudentRetryResult('qa-0', 2, second.items[0].itemId, true);
    });
    await page.locator('#generateStudentRetryButton').click();
    await page.waitForFunction(() => getStudentRetryState(getSelectedRetrySession(), 'qa-0').rounds.length === 3);
    assert((await assigned()).length === 1 && (await assigned())[0].difficulty === 'easy' && (await assigned())[0].retryRound === 3);
    // Independent usage resets preserve the history records.
    await page.evaluate(() => {
      state.libraryCache.examSets = [{ examId: 'qa-used', schoolKey: 'qa', librarySourceKey: 'neoreunteo', updatedAt: 1 }];
      state.libraryCache.examItems = [{ examId: 'qa-used', librarySourceKey: 'neoreunteo', problemRecordId: 'qa-used', passageTypeKey: 'qa-used' }];
      renderExamSlots();
    });
    await page.locator('#resetSchoolUsedProblemsButton').click();
    assert.equal(await page.evaluate(() => getSchoolUsedProblemIds().size), 0);
    assert.equal(await page.evaluate(() => getSchoolUsedPassageTypeKeys().size), 1);
    await page.locator('#resetSchoolUsedPassageTypesButton').click();
    assert.equal(await page.evaluate(() => getSchoolUsedPassageTypeKeys().size), 0);
    assert.equal(await page.evaluate(() => state.libraryCache.examSets.length), 1);
    await page.locator('#studentRetryRoot').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'student-difficulty-mobile.png') });
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    console.log('PASS: real imported rounds, scoped non-destructive resets, collapsed review/keyboard, per-student first-round output/CHECK targets, wrong-only rounds 2/3, cancellation and desktop/mobile; no production access');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
