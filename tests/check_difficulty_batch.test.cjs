const assert = require('node:assert/strict');
const app = require('./app_vm.cjs')(), c = app.context;
c.records = ['easy', 'medium', 'hard'].flatMap(difficulty => ['topic', 'title'].flatMap(type =>
  [1, 2, 3].map(retryRound => ({ kind: 'problem', recordId: `${type}-${difficulty}-${retryRound}`, sourceId: 'source',
    passageKey: 'passage', problemType: type === 'topic' ? '주제' : '제목', retryMode: 'rounds', retryRound, difficulty,
    retryGroupId: JSON.stringify(['unit.json', 'passage', type, difficulty]), answerText: '①', promptText: 'Choose.' }))));
c.students = ['One', 'Two', 'Three'].map((name, index) => ({ studentId: 's' + index, name, schoolKey: 'qa', firebaseUid: 'uid' + index, classIds: ['class-a'] }));
c.entries = c.records.filter(record => record.difficulty === 'medium' && record.retryRound === 1).map(record => ({ record }));
c.state = { schoolWorkflow: { selectedSchoolKey: 'qa', sourceFilterKey: 'all', draftMode: 'distinct' },
  examBuilder: { slots: [], checkSetDifficulties: [{ studentId: 's0', difficulty: 'easy' }, { studentId: 's1', difficulty: 'hard' }] },
  libraryCache: { problemRecords: c.records, checkSetRecords: [] }, studentRetry: { sessions: [], students: c.students } };
c.elements = Object.fromEntries(Object.entries({ examCheckSetTitleInput: 'Batch', examCheckSetIdInput: 'batch',
  examCheckSetClassIdsInput: 'class-a', examCheckSetDescriptionInput: '' }).map(([key, value]) => [key, { value }]));
app.run(`getCurrentExamCheckSetQuestionEntries = () => entries; getSelectedSchoolProfile = () => ({key:'qa',name:'QA'});
  getCurrentStudentRetryDraftContext = () => null; getCheckSetTargetStudentsForSummary = () => students;`);
const original = JSON.stringify(c.state);
const batch = app.pure('prepareDifficultyCheckBatch()');
assert.equal(batch.personalDrafts.length, 3);
assert.equal(Object.keys(batch.session.studentStates).length, 3);
for (const [index, difficulty] of ['easy', 'hard', 'medium'].entries()) {
  const draft = batch.personalDrafts[index];
  assert.equal(draft.targetFirebaseUid, 'uid' + index);
  assert.equal(draft.studentRetryStudentId, 's' + index);
  assert.equal(draft.studentRetrySessionId, batch.session.sessionId);
  assert.equal(draft.studentRetryRoundIndex, 1);
  assert(draft.questionMappings.every(item => item.problemRecordId.includes('-' + difficulty + '-1')));
  assert.deepEqual(Array.from(draft.exportPayload.targetUserIds), ['uid' + index]);
  assert.equal(draft.exportPayload.questions.length, 2);
  assert(batch.session.studentStates['s' + index].rounds[0].items.every(item => item.difficulty === difficulty));
}
assert.equal(JSON.stringify(c.state), original, 'preflight does not write or mutate draft/session data');
const normalEntries = c.entries;
c.entries = [{ record: c.records.find(record => record.retryRound === 2) }];
assert.throws(() => app.pure('prepareDifficultyCheckBatch()'), /1차 기준/);
c.entries = normalEntries;
c.entries = c.records.filter(record => record.retryRound === 1).map(record => ({ record }));
const allLevels = app.pure('prepareDifficultyCheckBatch()');
assert(allLevels.personalDrafts.every(draft => draft.questions.length === 2 && new Set(draft.questionMappings.map(item => item.problemRecordId)).size === 2),
  'full/all-level draft produces one corresponding first-round question per family');
c.entries = normalEntries;
c.state.studentRetry.sessions.push(batch.session);
const repeated = app.pure('prepareDifficultyCheckBatch()');
assert.equal(repeated.session.sessionId, batch.session.sessionId);
assert.deepEqual(Array.from(repeated.personalDrafts, draft => draft.checkSetId), Array.from(batch.personalDrafts, draft => draft.checkSetId));
c.state.examBuilder.checkSetDifficulties[0].difficulty = 'hard';
const changed = app.pure('prepareDifficultyCheckBatch()');
assert.notEqual(changed.session.sessionId, batch.session.sessionId);
assert(changed.personalDrafts.every(draft => !batch.personalDrafts.some(old => old.checkSetId === draft.checkSetId)), 'changed plans cannot overwrite old CHECKs');
c.left = { students: c.students, sessions: [batch.session] }; c.right = { students: c.students, sessions: [changed.session] };
for (const expression of ['mergeStudentRetryStates(left,right)', 'mergeStudentRetryStates(right,left)']) {
  const merged = app.pure(expression);
  assert.equal(merged.sessions.length, 2, 'different batch assignments cannot merge by the common base questions');
}
c.state.libraryCache.problemRecords = c.records.filter(record => record.recordId !== 'title-hard-1');
const beforeFailure = JSON.stringify(c.state);
assert.throws(() => app.pure('prepareDifficultyCheckBatch()'), /대응/);
assert.equal(JSON.stringify(c.state), beforeFailure, 'one missing counterpart prevents the entire batch before writes');
// The ordinary JSON path keeps the same questions and class-scoped personal targets.
c.entries = normalEntries.map(entry => ({ record: { ...entry.record, retryMode: 'general', retryRound: 0, difficulty: '' } }));
app.run('getCheckSetTargetStudentsForCurrentDraft = () => students');
const generalBatch = app.pure('prepareDifficultyCheckBatch()');
assert.equal(generalBatch.session, null);
assert.equal(generalBatch.personalDrafts.length, 3);
assert(generalBatch.personalDrafts.every(draft => draft.questionMappings.every(item => item.problemRecordId.includes('-medium-1'))));
const tail = { ...c.records[0], recordId: 'tail', retryMode: 'general', retryRound: 0, problemType: app.pure('PROBLEM_TYPE_TAIL') };
c.records.push(tail); c.state.libraryCache.problemRecords = c.records;
c.entries = [...normalEntries, { record: tail }];
const mixed = app.pure('prepareDifficultyCheckBatch()');
assert(mixed.personalDrafts.every(draft => draft.questions.length === 3 && draft.questionMappings.some(item => item.problemRecordId === 'tail')),
  'ordinary tail questions remain in the complete CHECK');
assert(Object.values(mixed.session.studentStates).every(value => value.rounds[0].items.length === 2), 'tail packs keep the existing separate retry behavior');
c.state.libraryCache.checkSetRecords = mixed.personalDrafts;
c.session = mixed.session; c.student = c.students[0]; c.round = mixed.session.studentStates.s0.rounds[0];
assert.equal(app.pure('getRetryCheckSetRecordsForRound(session,student,round).length'), 1, 'CHECK results still match the non-tail retry subset');
c.mixedRecord = mixed.personalDrafts[0];
assert.equal(app.pure('createRetryBaseItemsFromCheckSetRecord(mixedRecord).length'), 2);
(async () => {
  const count = c.state.studentRetry.sessions.length;
  c.state.studentRetryOwnerUid = 'old';
  c.fakeDb = { transaction() { throw new Error('must not write after account switch'); } };
  app.run('openLibraryDb = async () => { state.studentRetryOwnerUid = "new"; return fakeDb; }');
  await assert.rejects(app.run('persistExamCheckSet()'), /계정이 변경/);
  assert.equal(c.state.studentRetry.sessions.length, count);
  // A switch while committing must also stop before cross-account session insertion/upload.
  c.state.studentRetryOwnerUid = 'old';
  c.entries = normalEntries;
  c.state.libraryCache.problemRecords = c.records;
  c.fakeDb = { transaction: () => ({ objectStore: () => ({ put: () => {} }) }) };
  app.constant('LIBRARY_CHECK_SET_STORE');
  app.run('openLibraryDb = async () => fakeDb; idbTransactionDone = async () => { state.studentRetryOwnerUid = "new"; };');
  await assert.rejects(app.run('persistExamCheckSet()'), /계정이 변경/);
  assert.equal(c.state.studentRetry.sessions.length, count);
  console.log('PASS: mixed difficulty plans, actual questions/mappings/targets, shared retry session, idempotence, old-set preservation, all-or-nothing preflight and account-switch protection');
})().catch(error => { console.error(error); process.exitCode = 1; });
