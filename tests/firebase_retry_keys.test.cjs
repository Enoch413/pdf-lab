const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const load = require('./app_vm.cjs');
const app = load('app/index.html', { crypto: webcrypto }), c = app.context;
const bytes = value => Buffer.byteLength(value, 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const docs = new Map();
function validate(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) assert(!value.some(Array.isArray), 'Firestore does not permit directly nested arrays');
  for (const [key, child] of Object.entries(value)) {
    assert(bytes(key) <= 1500, 'Firestore field key exceeds 1500 bytes');
    validate(child);
  }
}
const db = {
  collection(name) {
    const doc = id => {
      assert.equal(typeof id, 'string');
      assert(bytes(id) <= 1500, 'Firestore document ID exceeds 1500 bytes');
      const path = name + '/' + id;
      const ref = { id, path, set: async data => { validate(data); docs.set(path, clone(data)); },
        get: async () => ({ id, exists: docs.has(path), data: () => docs.get(path) }) };
      return ref;
    };
    return { doc, where: (field, op, value) => ({ get: async () => ({ docs: [...docs].filter(([key, data]) => key.startsWith(name + '/') && data[field] === value).map(([key, data]) => ({ id: key.slice(name.length + 1), ref: doc(key.slice(name.length + 1)), data: () => clone(data) })) }) }) };
  },
  runTransaction: async callback => callback({ get: ref => ref.get(), set: (ref, data) => { validate(data); docs.set(ref.path, clone(data)); } }),
  batch: () => { const rows = []; return { set: (ref, data) => rows.push([ref, data]), delete: ref => rows.push([ref, null]), commit: async () => { for (const [ref, data] of rows) if (data) await ref.set(data); else docs.delete(ref.path); } }; }
};
for (const name of ['DEFAULT_LIBRARY_SOURCE_KEY', 'FIREBASE_STUDENT_RETRY_PREF_COLLECTION', 'FIREBASE_STUDENT_RETRY_STUDENT_COLLECTION', 'FIREBASE_STUDENT_RETRY_SESSION_COLLECTION', 'FIREBASE_STUDENT_RETRY_STATE_COLLECTION', 'FIREBASE_STUDENT_RETRY_EXAM_COLLECTION', 'FIREBASE_STUDENT_RETRY_EXAM_ITEM_COLLECTION', 'FIREBASE_STUDENT_RETRY_WORK_COLLECTION']) app.constant(name);
app.run(`getStudentRetrySchoolKey = () => 'class'; getCheckSetRecordSourceKey = () => 'neoreunteo'; getCheckSetRecordSourceRound = () => 'round1';`);
c.items = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, problemRecordId: '교재-문항-대응번호-' + i, passageKey: 'passage', typeLabel: '주제', result: 'wrong' }));
c.sessionId = app.pure('buildRetrySessionIdFromCheckSetRecord({schoolKey:"class",sourceBatchId:"batch",sourceSetId:"set"},items)');
assert(bytes(c.sessionId) > 1500, 'reproduce the long CHECK-derived session identifier');
c.raw = { selectedStudentId: 's', selectedSessionId: c.sessionId, expandedRoundKeys: { [c.sessionId + '::s::1']: true, short: true }, students: [{ studentId: 's', name: '합성 학생', schoolKey: 'class' }], sessions: [{ sessionId: c.sessionId, schoolKey: 'class', sourceKey: 'neoreunteo', baseItems: c.items, studentStates: { s: { rounds: [{ roundIndex: 1, items: c.items }] } } }] };
c.state = { studentRetryOwnerUid: 'teacher', studentRetry: c.raw, firebaseSchoolBridge: { db, currentUser: { uid: 'teacher' }, currentProfile: { role: 'admin' } } };
c.setStatus = () => {};
(async () => {
  app.pure('normalizeStudentRetryState(raw)');
  app.pure('getExamSetHistoryScope({historyScope:"student-retry"})');
  const original = JSON.stringify(c.raw);
  const flat = await app.pure('flattenStudentRetryStateForFirebase(raw)');
  for (const row of [...flat.students, ...flat.sessions, ...flat.studentStates]) {
    assert(bytes(row.docId) <= 1500, 'long identifiers must be bounded at the storage boundary');
    assert(row.docId.startsWith('teacher__'), 'preserve the owner prefix required by existing security rules');
    validate(row.data);
  }
  validate(flat.prefs);
  assert.equal(await app.pure('createFirebaseRetryDocId("teacher","student","s")'), 'teacher__student__s', 'existing valid IDs must remain unchanged');
  for (const value of ['x'.repeat(2000), '가'.repeat(501), '같은앞부분'.repeat(500) + 'A', '같은앞부분'.repeat(500) + 'B']) {
    c.value = value;
    const id = await app.pure('createFirebaseRetryDocId("teacher","session",value)');
    assert(bytes(id) <= 1500);
    assert.equal(id, await app.pure('createFirebaseRetryDocId("teacher","session",value)'));
  }
  c.a = 'x'.repeat(3000) + 'a'; c.b = 'x'.repeat(3000) + 'b';
  assert.notEqual(await app.pure('createFirebaseRetryDocId("teacher","session",a)'), await app.pure('createFirebaseRetryDocId("teacher","session",b)'));
  assert.notEqual(await app.pure('createFirebaseRetryDocId("teacher","session",a)'), await app.pure('createFirebaseRetryDocId("other","session",a)'));
  const result = await app.pure('saveStudentRetryStateToFirebase({mergeRemote:false})');
  assert.equal(result.synced, true, result.reason);
  const loaded = await app.pure('loadStudentRetryStateFromFirebase()');
  assert.equal(loaded.state.selectedSessionId, c.sessionId);
  assert.equal(loaded.state.sessions[0].sessionId, c.sessionId);
  assert.equal(loaded.state.sessions[0].studentStates.s.rounds[0].items.length, 100);
  assert.equal(loaded.state.expandedRoundKeys[c.sessionId + '::s::1'], true);
  assert.equal(loaded.state.expandedRoundKeys.short, true);
  assert.equal(JSON.stringify(c.raw), original, 'do not migrate or truncate local session/problem IDs');
  c.exam = { examId: c.sessionId, historyScope: 'student-retry', title: '합성 시험' };
  c.examItems = [{ examId: c.sessionId, entryId: c.sessionId + '-item', slotIndex: 1 }];
  assert.equal((await app.pure('saveStudentRetryExamHistoryToFirebase(exam,examItems)')).synced, true);
  c.work = { workId: c.sessionId + '-work', kind: 'exam', payload: { studentRetry: { studentId: 's' } } };
  assert.equal((await app.pure('saveStudentRetryWorkToFirebase(work)')).synced, true);
  c.deleted = { ...c.raw, deletedSessions: { [c.sessionId]: 100 } };
  const tombstones = await app.pure('flattenStudentRetryStateForFirebase(deleted)');
  assert.equal(tombstones.sessions[0].data.deletedAt, 100);
  assert(bytes(tombstones.sessions[0].docId) <= 1500);
  // Hashing is asynchronous: switching accounts during it must stop before any write.
  const beforeSwitch = JSON.stringify([...docs]);
  let releaseHash, calls = 0;
  c.crypto = { subtle: { digest: (...args) => ++calls === 1
    ? new Promise(resolve => { releaseHash = () => resolve(new Uint8Array(32).buffer); })
    : webcrypto.subtle.digest(...args) } };
  const saving = app.pure('saveStudentRetryStateToFirebase({mergeRemote:false})');
  await new Promise(resolve => setImmediate(resolve));
  assert(releaseHash);
  c.state.studentRetryOwnerUid = 'other';
  c.state.firebaseSchoolBridge.currentUser = { uid: 'other' };
  releaseHash();
  assert.equal((await saving).reason, 'account-changed');
  assert.equal(JSON.stringify([...docs]), beforeSwitch);
  console.log('PASS: long CHECK IDs, UTF-8 limits, stable owner-scoped IDs, prefs/rounds save-load, history/work/tombstones, legacy IDs and local nonmutation');
})().catch(e => { console.error(e); process.exitCode = 1; });
