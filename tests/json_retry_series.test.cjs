// Run importer/retry/storage functions in isolation; never connect to Firebase.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const context = vm.createContext({});
for (const file of ['app/hanbujang_canonical.js', 'app/solbook_text_renderer.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
vm.runInContext([...html.matchAll(/^    (?:async )?function \w+\([^]*?^    }\r?$/gm)].map(m => m[0]).join('\n'), context);
// Resolve only constants used by the exercised functions, without app startup.
const constants = new Map([...html.matchAll(/^    const (\w+) = [^]*?;\r?$/gm)].map(m => [m[1], m[0].replace('const ', 'var ')]));
function run(code) {
  for (let attempts = 0; attempts < 150; attempts++) {
    try { return vm.runInContext(code, context); }
    catch (error) {
      const name = /^(\w+) is not defined/.exec(error.message)?.[1];
      if (!constants.has(name)) throw error;
      run(constants.get(name));
    }
  }
  throw new Error('Unresolved dependency');
}
function importItems(items, mode = 'rounds', filename = 'unit.json') {
  context.input = items;
  context.mode = mode;
  context.filename = filename;
  return run('assignJsonRetrySeries(createTextProblemsFromAiJsonItems(input, "Book", "neoreunteo", filename), input, mode, filename)');
}
const items = ['factual', 'unfactual'].flatMap(type => ['easy', 'hard', null].flatMap(difficulty =>
  [1, 2, 3].map(n => ({ type, difficulty, stem: 'Choose.', body: `${type} ${difficulty} ${n}`, answer: '①', choices: ['A', 'B', 'C', 'D', 'E'] }))));
const original = JSON.stringify(items);
const problems = importItems(items);
assert.equal(JSON.stringify(items), original);
assert.equal(new Set(problems.map(p => p.retryGroupId)).size, 6);
assert.deepEqual(Array.from(problems.slice(0, 3), p => p.retryRound), [1, 2, 3]);
assert.throws(() => importItems(items.slice(0, 2)), /정확히 3문항/);
assert.throws(() => importItems([...items.slice(0, 3), ...items.slice(0, 3)]), /정확히 3문항/);
const general = importItems(items, 'general');
assert.ok(general.every(p => p.retryMode === 'general' && p.retryRound === 0 && !p.retryGroupId));
context.entries = [{ name: 'one.json', payload: items }, { name: 'two.json', payload: items }];
const batch = run('prepareAiProblemJsonBatch(entries, "Book", "neoreunteo", "rounds")');
assert.equal(batch.length, items.length * 2);
assert.equal(new Set(batch.map(p => p.id)).size, batch.length);
assert.equal(new Set(batch.map(p => p.retryGroupId)).size, 12);
assert.equal(new Set(batch.map(p => p.worksheetRef)).size, 2);
assert.deepEqual(Array.from(batch, p => p.number), Array.from({length: batch.length}, (_, i) => i + 1));
context.entries[1].payload = items.slice(0, 2);
assert.throws(() => run('prepareAiProblemJsonBatch(entries, "Book", "neoreunteo", "rounds")'), /two.json.*정확히 3문항/);
context.entries[1] = context.entries[0];
assert.throws(() => run('prepareAiProblemJsonBatch(entries, "Book", "neoreunteo", "general")'), /중복/);
assert.ok(/id="problemJsonInput"[^>]*multiple/.test(html));
const records = problems.map((p, i) => ({ ...p, recordId: `r${i}`, sourceId: 'source', passageKey: 'passage', selectableType: p.problemType }));
const legacy = { ...records[0], recordId: 'legacy', retryMode: 'general' };
context.records = [...records, legacy, { ...records[1], sourceId: 'other', recordId: 'other-source' }];
run('getProblemRecordsOnly = () => records; doesRetryCandidateMatchItemSource = () => true; recordMatchesSchoolSource = () => true');
context.item = { problemRecordId: 'r0', passageKey: 'passage', typeLabel: '내용' };
context.used = new Set(['r0']);
assert.equal(run('findNextRetryCandidateForItem(item, used)').recordId, 'r1');
context.item.problemRecordId = 'r1';
assert.equal(run('findNextRetryCandidateForItem(item, used)').recordId, 'r2');
context.item.problemRecordId = 'r2';
assert.equal(run('findNextRetryCandidateForItem(item, used)'), null);
context.item.problemRecordId = 'r0'; context.used.add('r1');
assert.equal(run('findNextRetryCandidateForItem(item, used)'), null, 'Never skip a used second round');
context.item = { problemRecordId: 'gone', retryMode: 'rounds' };
assert.equal(run('findNextRetryCandidateForItem(item, used)'), null);
context.item = { problemRecordId: 'legacy', passageKey: 'passage', typeLabel: '내용' };
context.used = new Set();
assert.equal(run('findNextRetryCandidateForItem(item, used)').recordId, 'legacy');
context.state = { schoolWorkflow: {} };
assert.ok(run('getSchoolProblemRecordsOnly()').every(p => p.retryMode !== 'rounds' || p.retryRound === 1));
context.problem = problems[0];
context.source = { sourceId: 'source', librarySourceKey: 'neoreunteo', textbookName: 'Book', fileName: 'unit.json', importedAt: 1 };
(async () => {
  const record = await run('serializeProblemForLibrary(problem, source)');
  assert.equal(record.retryGroupId, problems[0].retryGroupId);
  assert.equal(run('splitProblemRecordStorage').call(null, record).metadataRecord.retryRound, 1);
  context.state = { selectedLibrarySourceKey: 'neoreunteo', imageUrls: [] };
  const saved = await run('serializeProblemForSavedWork(problem)');
  context.snapshot = saved;
  const restored = run('hydrateProblemFromSavedWork(snapshot)');
  for (const key of ['retryMode', 'retryGroupId', 'retryRound', 'difficulty']) assert.equal(restored[key], problems[0][key]);
  context.item = { ...record, problemRecordId: record.recordId, typeLabel: '내용', passageKey: 'passage' };
  assert.equal(run('normalizeStudentRetryRound({items:[item]}).items[0]').retryGroupId, record.retryGroupId);
  context.studentState = { rounds: [{ roundIndex: 1, items: [
    { problemRecordId: 'r0', passageKey: 'passage', typeLabel: '내용', result: 'wrong' },
    { problemRecordId: 'r3', passageKey: 'passage', typeLabel: '내용', result: 'correct' }
  ] }] };
  context.student = { studentId: 'student', name: 'QA' };
  context.session = { sessionId: 'session', name: 'QA' };
  context.state = { examBuilder: { slots: [] }, schoolWorkflow: {} };
  context.elements = Object.fromEntries(['examObjectiveCountInput', 'examSubjectiveCountInput', 'examTailCountInput', 'examKickerInput', 'examTitleInput', 'examSubtitleInput'].map(key => [key, {}]));
  run(`getSelectedRetryStudent = () => student; getSelectedRetrySession = () => session;
    getStudentRetryState = () => studentState; canUseFirebaseStudentRetryStorage = () => false;
    createSchoolDraftSlotFromRecord = record => ({category:'objective',assignedProblemId:record.recordId});`);
  for (const name of ['writeStudentRetryState', 'cleanupExamPreviewUrls', 'cleanupExamExportUrls', 'clearExamAnswerEditorState', 'renderExamSlots', 'renderStudentRetryPanel', 'revealSchoolDraftResult', 'setStatus']) run(`${name} = () => {}`);
  run('EXAM_SLOT_RENDER_BATCH_SIZE');
  run('generateNextStudentRetryRound()');
  assert.deepEqual(Array.from(context.studentState.rounds[1].items, p => p.problemRecordId), ['r1']);
  context.studentState.rounds[1].items[0].result = 'wrong';
  run('generateNextStudentRetryRound()');
  assert.deepEqual(Array.from(context.studentState.rounds[2].items, p => p.problemRecordId), ['r2']);
  context.studentState.rounds[2].items[0].result = 'wrong';
  assert.throws(() => run('generateNextStudentRetryRound()'), /3차까지/);
  assert.equal(context.studentState.rounds.length, 3, 'No fourth round is created');
  for (const corrected of [false, true]) {
    context.studentState = { rounds: [{ roundIndex: 1, items: ['r0', 'r3'].map(problemRecordId =>
      ({ problemRecordId, passageKey: 'passage', typeLabel: '내용', result: 'wrong' })) }] };
    context.checkRecord = { questionMappings: [{ questionId: 'q1', problemRecordId: 'r0' }, { questionId: 'q2', problemRecordId: 'r3' }] };
    context.checkResponse = { answers: [{ questionId: 'q1', isCorrect: corrected }] };
    run('applyCheckResponseToRetryRound(studentState.rounds[0], checkRecord, checkResponse)');
    run('generateNextStudentRetryRound()');
    assert.deepEqual(Array.from(context.studentState.rounds[1].items, p => p.problemRecordId), corrected ? ['r4'] : ['r1', 'r4'],
      'A missing CHECK answer retains its actual paired second-round problem');
  }
  if (process.env.PDFLAB_JSON_CHECK_DIR) {
    let count = 0;
    const entries = [];
    for (const name of fs.readdirSync(process.env.PDFLAB_JSON_CHECK_DIR).filter(n => n.endsWith('.json'))) {
      const rows = JSON.parse(fs.readFileSync(path.join(process.env.PDFLAB_JSON_CHECK_DIR, name), 'utf8').replace(/^\uFEFF/, ''));
      const imported = importItems(rows, 'rounds', name);
      assert.equal(imported.length, rows.length);
      count += imported.length;
      entries.push({name, payload: rows});
    }
    context.entries = entries;
    const combined = run('prepareAiProblemJsonBatch(entries, "Book", "neoreunteo", "rounds")');
    assert.equal(combined.length, count);
    assert.equal(new Set(combined.map(p => p.id)).size, count);
    assert.equal(new Set(combined.map(p => p.worksheetRef)).size, entries.length);
    console.log(`PASS: supplied JSONs: ${count} questions`);
  }
  console.log('PASS: round pairing, difficulty/type separation, validation, legacy fallback, first-round draft, storage roundtrip');
})().catch(error => { console.error(error); process.exitCode = 1; });
