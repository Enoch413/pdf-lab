const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');
const app = load(), c = app.context;
const storage = new Map();
c.window = { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, confirm: () => true };
c.state = { studentRetryOwnerUid: 'admin', schoolWorkflow: { selectedSchoolKey: 'A' },
  examBuilder: { slots: [] }, libraryCache: { examSets: [], examItems: [] } };
app.run(`getSelectedSchoolProfile = () => ({ key: state.schoolWorkflow.selectedSchoolKey, name: 'QA' });
  getSchoolSourceFilterKey = () => selectedSource; renderExamLibraryList = () => {}; renderExamSlots = () => {};
  setStatus = () => {};`);
c.selectedSource = 'all';
c.state.libraryCache.examSets = [
  { examId: 'old', schoolKey: 'A', librarySourceKey: 'neoreunteo', updatedAt: 1 },
  { examId: 'foreign', schoolKey: 'B', librarySourceKey: 'neoreunteo', updatedAt: 1 },
  { examId: 'personal', schoolKey: 'A', historyScope: 'student-retry', updatedAt: 1 }
];
c.state.libraryCache.examItems = c.state.libraryCache.examSets.map(set => ({ examId: set.examId,
  librarySourceKey: 'neoreunteo', problemRecordId: set.examId, passageTypeKey: set.examId, category: 'tail', tailPackKey: set.examId }));
const before = JSON.stringify(c.state.libraryCache);
assert.equal(app.pure('getSchoolUsedProblemIds().has("old")'), true);
app.pure('resetPreviousSchoolUsage("problems")');
assert.equal(app.pure('getSchoolUsedProblemIds().size'), 0);
assert.equal(app.pure('getSchoolUsedPassageTypeKeys().has("old")'), true, 'separate reset kinds');
app.pure('resetPreviousSchoolUsage("passageTypes")');
assert.equal(app.pure('getSchoolUsedPassageTypeKeys().size'), 0);
assert.equal(app.pure('getSchoolUsedTailPackKeys().size'), 0);
assert.equal(JSON.stringify(c.state.libraryCache), before, 'reset never deletes or changes history');
c.state.libraryCache.examSets[0].updatedAt = 2;
assert.equal(app.pure('getSchoolUsedProblemIds().has("old")'), true, 'a newly used exam version counts again');
c.state.studentRetryOwnerUid = 'other';
assert.equal(app.pure('getSchoolUsedProblemIds().has("old")'), true, 'account isolation');
c.state.studentRetryOwnerUid = 'admin'; c.state.schoolWorkflow.selectedSchoolKey = 'B';
assert.equal(app.pure('getSchoolUsedProblemIds().has("foreign")'), true, 'class isolation');
c.state.schoolWorkflow.selectedSchoolKey = 'A';
c.window.confirm = () => false;
const saved = JSON.stringify([...storage]);
app.pure('resetPreviousSchoolUsage("problems")');
assert.equal(JSON.stringify([...storage]), saved, 'cancel does not write');
c.window.confirm = () => true;
c.state.libraryCache.examSets.push({ examId: 'other-source', schoolKey: 'A', librarySourceKey: 'thelab4you', updatedAt: 3 });
c.state.libraryCache.examItems.push({ examId: 'other-source', librarySourceKey: 'thelab4you', problemRecordId: 'other-source' });
c.selectedSource = 'neoreunteo';
app.pure('resetPreviousSchoolUsage("problems")');
c.selectedSource = 'all';
assert.deepEqual(Array.from(app.pure('getSchoolUsedProblemIds()')), ['other-source'], 'source-specific reset applies when viewing all sources');
const savedSetItem = c.window.localStorage.setItem;
c.window.localStorage.setItem = () => { throw new Error('quota'); };
assert.throws(() => app.pure('resetPreviousSchoolUsage("problems")'), /저장하지 못/);
c.window.localStorage.setItem = savedSetItem;
assert.deepEqual(Array.from(app.pure('getSchoolUsedProblemIds()')), ['other-source'], 'storage failure leaves the prior baseline intact');

// Same source/passage/original type family, three difficulties, three rounds.
c.records = ['easy', 'medium', 'hard'].flatMap(difficulty => ['factual', 'unfactual'].flatMap(type =>
  [1, 2, 3].map(retryRound => ({ recordId: `${type}-${difficulty}-${retryRound}`, kind: 'problem', sourceId: 'source',
    passageKey: 'passage', problemType: '내용', retryMode: 'rounds', retryRound, difficulty,
    retryGroupId: JSON.stringify(['unit.json', 'passage', type, difficulty]) }))));
c.records.push({ ...c.records[0], recordId: 'foreign', sourceId: 'other', difficulty: 'hard' });
c.state.libraryCache.problemRecords = c.records;
c.baseItems = ['factual', 'unfactual'].map(type => ({ problemRecordId: `${type}-medium-1`, displayNumber: type === 'factual' ? 1 : 2 }));
const original = JSON.stringify(c.records);
const easy = app.pure('buildStudentDifficultyFirstRoundItems(baseItems, "easy")');
assert.deepEqual(Array.from(easy, item => item.problemRecordId), ['factual-easy-1', 'unfactual-easy-1']);
assert.deepEqual(Array.from(easy, item => item.displayNumber), [1, 2]);
assert.equal(JSON.stringify(c.records), original);
c.baseItems.push({ ...c.baseItems[0], problemRecordId: 'factual-hard-1' });
assert.throws(() => app.pure('buildStudentDifficultyFirstRoundItems(baseItems, "easy")'), /중복/);
c.baseItems.pop();
c.baseItems.push({ problemRecordId: 'missing' });
assert.throws(() => app.pure('buildStudentDifficultyFirstRoundItems(baseItems, "easy")'), /찾|없/);
c.baseItems.pop();
c.records = c.records.filter(r => r.recordId !== 'unfactual-hard-1');
c.state.libraryCache.problemRecords = c.records;
assert.throws(() => app.pure('buildStudentDifficultyFirstRoundItems(baseItems, "hard")'), /대응/);
c.state.libraryCache.problemRecords = [];
assert(app.html.includes('id="schoolDraftReview"'));
assert(!/<details[^>]*id="schoolDraftReview"[^>]*\sopen(?:\s|>)/.test(app.html), 'review starts collapsed');

// Actual student assignment, persistence, stale sync and first-round output context.
const a = load(), d = a.context;
d.records = JSON.parse(original);
d.state = { schoolWorkflow: { selectedSchoolKey: 'A', sourceFilterKey: 'all', warnings: [] },
  studentRetry: { students: [{ studentId: 's1', schoolKey: 'A', name: 'One' }, { studentId: 's2', schoolKey: 'A', name: 'Two' }],
    sessions: [], selectedStudentId: 's1', selectedSessionId: 'session' },
  examBuilder: { slots: [] }, libraryCache: { problemRecords: d.records, examSets: [], examItems: [], checkSetRecords: [] } };
d.window = { confirm: () => true };
d.elements = Object.fromEntries(['examObjectiveCountInput', 'examSubjectiveCountInput', 'examTailCountInput', 'examTitleInput', 'examSubtitleInput', 'examKickerInput'].map(key => [key, {}]));
a.run(`renderStudentRetryPanel = () => {}; renderExamSlots = () => {}; setStatus = () => {};
  confirmWorkspaceDiscard = () => true; writeStudentRetryState = () => {};
  clearGeneratedSchoolDraft = () => { state.examBuilder.slots = []; }; revealSchoolDraftResult = () => {};
  createSchoolDraftSlotFromRecord = record => ({assignedProblemId:record.recordId, category:'objective'});`);
d.session = { sessionId: 'session', schoolKey: 'A', sourceKey: 'all', name: 'QA', createdAt: 1, updatedAt: 1,
  baseItems: ['factual', 'unfactual'].map((type, index) => a.pure(`createRetryItemFromRecord(records.find(r=>r.recordId===${JSON.stringify(type + '-medium-1')}), ${index + 1})`)), studentStates: {} };
d.state.studentRetry.sessions.push(d.session);
a.run('getStudentRetryState(session,"s1"); getStudentRetryState(session,"s2")');
const oldState = JSON.stringify(d.state.studentRetry);
a.pure('applySelectedStudentFirstRoundDifficulty("easy")');
assert.deepEqual(Array.from(d.session.studentStates.s1.rounds[0].items, item => item.difficulty), ['easy', 'easy']);
assert(d.session.studentStates.s2.rounds[0].items.every(item => item.difficulty === 'medium'));
assert(d.session.baseItems.every(item => item.difficulty === 'medium'));
d.old = JSON.parse(oldState); d.fresh = a.pure('captureStudentRetryState()');
for (const order of ['mergeStudentRetryStates(fresh,old)', 'mergeStudentRetryStates(old,fresh)']) {
  const merged = a.pure(order);
  const studentState = merged.sessions[0].studentStates.s1;
  assert.equal(studentState.rounds.length, 1, 'old common first round must not reappear after sync');
  assert(studentState.rounds[0].items.every(item => item.difficulty === 'easy'));
  assert(studentState.firstRoundAssignedAt > 0);
}
a.pure('loadSelectedStudentFirstRoundDraft()');
assert(d.state.examBuilder.slots.every(slot => slot.studentRetryStudentId === 's1' && slot.studentRetryRoundIndex === 1));
assert.equal(a.pure('getCurrentStudentRetryDraftContext().studentId'), 's1');
d.staleRound = d.old.sessions[0].studentStates.s1.rounds[0];
assert.equal(a.pure('upsertStudentRetryRound(session,"s1",staleRound)'), false, 'old CHECK/history cannot replace assigned first round');
d.session.studentStates.s1.rounds[0].items[0].result = 'wrong';
assert.throws(() => a.pure('applySelectedStudentFirstRoundDifficulty("hard")'), /이력/);
assert(d.session.studentStates.s1.rounds[0].items.every(item => item.difficulty === 'easy'));
d.round = d.session.studentStates.s1.rounds[0]; d.student = d.state.studentRetry.students[0];
d.personalCheck = { checkSetId: 'personal', schoolKey: 'A', sourceRound: 'round1', librarySourceKey: 'thelab4you',
  studentRetrySessionId: 'session', targetStudentName: 'One', questionMappings: d.round.items.map(item => ({ ...item })) };
d.state.libraryCache.checkSetRecords = [d.personalCheck, { ...d.personalCheck, checkSetId: 'common', questionMappings: d.session.baseItems },
  { ...d.personalCheck, checkSetId: 'another-student', targetStudentName: 'Two' }];
assert.deepEqual(Array.from(a.pure('getRetryCheckSetRecordsForRound(session,student,round)'), record => record.checkSetId), ['personal'],
  'first-round CHECK matches the student items and target, including all-source sessions');
assert.equal(a.pure('findExistingRetrySessionForCheckSetRecord(personalCheck,round.items).sessionId'), 'session');
d.restored = { roundIndex: 1, updatedAt: 123, items: d.records.filter(record => record.retryRound === 1 && record.difficulty === 'hard' && record.sourceId === 'source')
  .map((record, index) => a.pure(`createRetryItemFromRecord(records.find(r=>r.recordId===${JSON.stringify(record.recordId)}),${index + 1})`)) };
assert.equal(a.pure('upsertStudentRetryRound(session,"s2",restored)'), true, 'restore a personal first-round output into an unassigned common state');
assert(d.session.studentStates.s2.rounds[0].items.every(item => item.difficulty === 'hard'));
console.log('PASS: non-destructive scoped resets, cancellation, new use, account isolation, exact student difficulty pairing, student-specific loading, stale sync protection and collapsed review');
