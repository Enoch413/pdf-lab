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
  c.state.schoolWorkflow.difficultyFilter = difficulty;
  const candidates = app.pure('getSchoolProblemRecordsOnly()');
  assert(candidates.some(r => r.recordId === 'general'), 'general mode keeps its existing candidates');
  assert(candidates.every(r => r.retryMode !== 'rounds' || (r.retryRound === 1 &&
    (!difficulty || (r.difficulty || 'none') === difficulty))), 'initial round must respect selected difficulty');
  for (const builder of ['buildSchoolDistinctDraft', 'buildSchoolFullDraft']) {
    const draft = app.pure(builder + '()');
    assert.equal(draft.slots.length, !difficulty && builder === 'buildSchoolFullDraft' ? 20 : 4);
    assert(draft.slots.every(s => !difficulty || s.id.startsWith((difficulty === 'none' ? '' : difficulty) + '-')));
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
// Cancel preserves the draft, edits and selection; active retry drafts are locked.
c.elements = { schoolDifficultySelect: {} };
c.allowDiscard = false; c.retryActive = false; c.cleared = 0;
app.run(`isStudentRetryDraftActive = () => retryActive;
  confirmWorkspaceDiscard = () => allowDiscard;
  clearGeneratedSchoolDraft = () => { cleared++; state.examBuilder.slots = []; };
  renderExamLibraryList = () => {}; updateExamBuilderSummary = () => {}; setStatus = () => {};`);
c.state.examBuilder.slots = [{ id: 'edited' }];
app.run('setSchoolDifficulty("easy")');
assert.equal(c.state.schoolWorkflow.difficultyFilter, 'hard');
assert.equal(c.state.examBuilder.slots[0].id, 'edited');
assert.equal(c.elements.schoolDifficultySelect.value, 'hard');
c.allowDiscard = true;
app.run('setSchoolDifficulty("easy")');
assert.equal(c.state.schoolWorkflow.difficultyFilter, 'easy');
assert.equal(c.cleared, 1);
c.retryActive = true;
app.run('setSchoolDifficulty("hard")');
assert.equal(c.state.schoolWorkflow.difficultyFilter, 'easy');
assert.equal(c.cleared, 1);
// Save/load and legacy defaults preserve selection without altering saved slots.
app.run(`getSchoolSourceFilterKey = () => 'all'; applySelectedSchoolClassIdsToCheckSetInput = () => {};`);
c.snapshot = app.pure('captureSchoolWorkflowSnapshot()');
assert.equal(c.snapshot.difficultyFilter, 'easy');
app.pure('applySchoolWorkflowSnapshot(snapshot)');
assert.equal(c.state.schoolWorkflow.difficultyFilter, 'easy');
app.pure('applySchoolWorkflowSnapshot({})');
assert.equal(c.state.schoolWorkflow.difficultyFilter, '');
assert(app.html.includes('for="schoolDifficultySelect"'));
assert(app.html.includes('setSchoolDifficulty(elements.schoolDifficultySelect.value)'));
console.log('PASS: round difficulty in both draft modes, general compatibility, source scoping, retry chain, cancellation, retry locking and saved selection');
