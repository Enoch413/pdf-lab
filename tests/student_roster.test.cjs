const assert = require('node:assert/strict');
const app = require('./app_vm.cjs')(), c = app.context;
c.profile = { uid: 'teacher', role: 'admin', adminScope: 'all', loginDisabled: false, classIds: [] };
c.users = [
  { uid: 'active', name: '재원 학생', role: 'student', classIds: ['class-a'], loginDisabled: false },
  { uid: 'retired', name: '퇴원 학생', role: 'student', classIds: ['class-a'], loginDisabled: true },
  { uid: 'moved', name: '이동 학생', role: 'student', classIds: ['class-b'], loginDisabled: false },
  { uid: 'homonym', name: '퇴원 학생', role: 'student', classIds: ['class-a'], loginDisabled: false }
];
const students = c.users.map(user => ({ studentId: 'local-' + user.uid, firebaseUid: user.uid, name: user.name, schoolKey: 'class-a' }));
students.push({ studentId: 'deleted', firebaseUid: 'removed-user', name: '삭제 학생', schoolKey: 'class-a' });
students.push({ studentId: 'manual', name: '로컬 학생', schoolKey: 'class-a' });
c.state = { studentRetryOwnerUid: 'teacher', studentRetry: { students, sessions: [{ sessionId: 'history', studentStates: { 'local-retired': { rounds: [{ roundIndex: 1, items: [{ problemRecordId: 'old', result: 'wrong' }] }] } } }] },
  firebaseSchoolBridge: { currentUser: { uid: 'teacher' }, currentProfile: c.profile, firebaseUsers: c.users, classCatalog: [] } };
app.run(`getSelectedSchoolClassIds = () => ['class-a']; getStudentRetrySchoolKey = () => 'class-a';`);
c.state.firebaseSchoolBridge.studentRosterScope = app.pure('createFirebaseProfileScopeSignature(profile)');
const history = JSON.stringify(c.state.studentRetry);
assert.deepEqual(Array.from(app.pure('computeFirebaseStudentCatalogForSelectedSchool()'), user => user.uid).sort(), ['active', 'homonym']);
assert.deepEqual(Array.from(app.pure('getRetryStudentsForSelectedSchool()'), student => student.studentId).sort(), ['local-active', 'local-homonym', 'manual']);
assert.equal(JSON.stringify(c.state.studentRetry), history, 'hiding departed students must not delete or modify history');
// A completed empty roster is different from a loading/error state.
c.state.firebaseSchoolBridge.firebaseUsers = [];
assert.deepEqual(Array.from(app.pure('getRetryStudentsForSelectedSchool()'), student => student.studentId), ['manual']);
c.state.firebaseSchoolBridge.studentRosterScope = '';
assert.equal(app.pure('getRetryStudentsForSelectedSchool().length'), students.length, 'unknown roster keeps offline data instead of treating it as a complete empty roster');
c.state.firebaseSchoolBridge.firebaseUsers = c.users;
c.state.firebaseSchoolBridge.studentRosterScope = app.pure('createFirebaseProfileScopeSignature(profile)');
c.profile.classIds = ['different-scope'];
assert.equal(app.pure('getRetryStudentsForSelectedSchool().length'), students.length, 'an old scope cannot certify a different catalog');
c.profile.classIds = [];
c.context = { student: students.find(student => student.firebaseUid === 'retired'), studentId: 'local-retired' };
app.run('ensureFirebaseRetryStudentsForSelectedSchool = () => 0; writeStudentRetryState = () => { throw new Error("unexpected write"); };');
assert.throws(() => app.pure('getCheckSetTargetStudentsForCurrentDraft(context)'), /퇴원|비활성/);
assert.equal(app.pure('getCheckSetTargetStudentsForSummary(context).length'), 0, 'saved departed-student drafts are not new CHECK targets');
// Returning students can reappear without erasing their old identity/history.
c.users[1].loginDisabled = false;
assert(app.pure('getRetryStudentsForSelectedSchool()').some(student => student.firebaseUid === 'retired'));
assert.equal(JSON.stringify(c.state.studentRetry), history);
console.log('PASS: inactive/deleted/transferred roster exclusion, UID-safe homonyms, completed-empty vs loading, scope isolation, returning students and preserved retry history');
