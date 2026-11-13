const assert = require('node:assert/strict');
const app = require('./app_vm.cjs')(), c = app.context;
c.state = { schoolWorkflow: {
  selectedPassageKeys: ['A', 'B'], selectedTypeLabels: ['주제', '제목'],
  excludeUsedProblems: false, excludeUsedPassageTypes: false, warnings: []
}, examBuilder: { slots: [] }, libraryCache: { problemRecords: [] } };
c.records = ['easy', 'medium', 'hard', '', 'advanced'].flatMap(difficulty =>
  ['A', 'B'].flatMap(passageKey => ['주제', '제목'].flatMap(problemType =>
    [1, 2, 3].map(retryRound => ({
      kind: 'problem', recordId: `${difficulty}-${passageKey}-${problemType}-${retryRound}`,
      sourceId: 'source', librarySourceKey: 'neoreunteo', textbookName: 'Book', passageKey,
      problemType, retryMode: 'rounds', retryGroupId: `${difficulty}-${passageKey}-${problemType}`,
      retryRound, difficulty
    })))));
c.records.push({ kind: 'problem', recordId: 'general', passageKey: 'G', problemType: '주제', retryMode: 'general', difficulty: 'hard' });
c.state.libraryCache.problemRecords = c.records;
app.run(`recordMatchesSchoolSource = record => record.sourceId !== 'other';
  getSchoolUsedProblemIds = () => new Set(); getSchoolUsedPassageTypeKeys = () => new Set();
  getSchoolPassageUsageCounts = () => new Map();
  createSchoolDraftSlotFromRecord = record => ({ id: record.recordId, category: 'objective',
    assignedProblemId: record.recordId, passageKey: record.passageKey, selectedType: record.problemType });`);
const original = JSON.stringify(c.records);
for (const difficulty of ['', 'easy', 'medium', 'hard', 'none', 'advanced']) {
  // Old saved settings must not silently narrow new drafts after removing the control.
  c.state.schoolWorkflow.difficultyFilter = difficulty;
  const candidates = app.pure('getSchoolProblemRecordsOnly()');
  assert(candidates.some(r => r.recordId === 'general'), 'general mode keeps its existing candidates');
  assert.equal(candidates.length, 21, 'all first-round difficulties remain available regardless of legacy filter');
  assert(candidates.every(r => r.retryMode !== 'rounds' || r.retryRound === 1));
  for (const builder of ['buildSchoolDistinctDraft', 'buildSchoolFullDraft']) {
    const draft = app.pure(builder + '()');
    assert.equal(draft.slots.length, builder === 'buildSchoolFullDraft' ? 20 : 4);
    assert.equal(draft.warnings.length, 0);
  }
}
assert.equal(JSON.stringify(c.records), original, 'filtering never changes library data or retry IDs');
for (const [alias, key] of [['하', 'easy'], ['쉬움', 'easy'], ['중', 'medium'], ['보통', 'medium'], ['상', 'hard'], ['어려움', 'hard'], ['', 'none']]) {
  c.value = alias;
  assert.equal(app.run('normalizeSchoolDifficulty(value)'), key);
}
for (const value of ['constructor', '__proto__', '<custom>']) {
  c.value = value;
  assert.equal(app.run('normalizeSchoolDifficulty(value)'), value);
  assert.equal(app.run('getSchoolDifficultyLabel(value)'), value);
}
c.records.push({ ...c.records[0], recordId: 'foreign', sourceId: 'other', difficulty: 'foreign' });
assert.deepEqual(Array.from(app.pure('getSchoolDifficultyOptions()')), ['easy', 'medium', 'hard', 'none', 'advanced']);
// Difficulty does not redirect an existing retry chain, even after changing the filter.
c.item = { problemRecordId: 'easy-A-주제-1' }; c.used = new Set();
c.state.schoolWorkflow.difficultyFilter = 'hard';
app.run('doesRetryCandidateMatchItemSource = () => true');
assert.equal(app.pure('findNextRetryCandidateForItem(item, used)').recordId, 'easy-A-주제-2');
c.item.problemRecordId = 'easy-A-주제-2';
assert.equal(app.pure('findNextRetryCandidateForItem(item, used)').recordId, 'easy-A-주제-3');
// Legacy snapshots drop the removed setting without changing saved questions or CHECK assignments.
c.elements = {};
c.state.examBuilder.slots = [{ id: 'edited' }];
c.state.examBuilder.checkSetDifficulties = [{studentId:'student',difficulty:'easy'}];
app.run(`getSchoolSourceFilterKey = () => 'all'; applySelectedSchoolClassIdsToCheckSetInput = () => {};`);
c.snapshot = app.pure('captureSchoolWorkflowSnapshot()');
assert.equal(Object.hasOwn(c.snapshot, 'difficultyFilter'), false);
c.snapshot.difficultyFilter = 'hard';
app.pure('applySchoolWorkflowSnapshot(snapshot)');
assert.equal(Object.hasOwn(c.state.schoolWorkflow, 'difficultyFilter'), false);
assert.equal(app.pure('getSchoolProblemRecordsOnly().length'), 21);
assert.equal(c.state.examBuilder.slots[0].id, 'edited');
assert.equal(c.state.examBuilder.checkSetDifficulties[0].difficulty, 'easy');
app.pure('applySchoolWorkflowSnapshot({})');
assert.equal(Object.hasOwn(c.state.schoolWorkflow, 'difficultyFilter'), false);
assert(!app.html.includes('id="schoolDifficultySelect"'));
assert(!app.html.includes('function setSchoolDifficulty('));
console.log('PASS: difficulty only in CHECK, all first-round draft candidates, general/source compatibility, retry chains and legacy filter removal without losing saved edits');
