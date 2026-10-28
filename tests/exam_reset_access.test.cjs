const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');

function fixture(overrides = {}) {
  const app = load();
  let reads = 0, applied = [];
  const profile = { uid: 'admin', role: 'admin', adminScope: 'all', loginDisabled: false, ...overrides };
  const bridge = { currentUser: { uid: 'admin' }, currentProfile: profile, auth: { currentUser: { uid: 'admin' } },
    db: { collection(name) { assert.equal(name, 'portalContent'); return { doc(id) { assert.equal(id, 'exam-state');
      return { get: async () => { reads++; return { exists: true, data: () => ({ payload: { pdfLabResetToken: 'synthetic-token' } }) }; } }; } }; } } };
  app.context.state = { firebaseSchoolBridge: bridge };
  app.context.capture = payload => { applied.push(payload); return true; };
  app.run('ensurePdfLabFirebaseServices = () => true; applyCodeLabExamResetIfNeeded = capture');
  return { app, bridge, applied, reads: () => reads, run: () => app.run('syncCodeLabExamResetFromFirebase()') };
}

(async () => {
  for (const profile of [
    { adminScope: 'assigned' }, { adminScope: 'classes' }, { adminScope: '' },
    { role: 'student' }, { loginDisabled: true }, { loginDisabled: 'false' }, { uid: 'other' }
  ]) {
    const f = fixture(profile);
    assert.equal(await f.run(), false);
    assert.equal(f.reads(), 0, 'Unauthorized profiles must not request the global document');
    assert.equal(f.applied.length, 0, 'Scoped/disabled accounts must not apply global resets');
  }
  const allowed = fixture();
  assert.equal(await allowed.run(), true);
  assert.equal(allowed.reads(), 1);
  assert.equal(allowed.applied[0].pdfLabResetToken, 'synthetic-token');
  for (const change of [
    f => { f.bridge.auth.currentUser = null; },
    f => { f.bridge.auth.currentUser = { uid: 'other' }; },
    f => { f.bridge.currentProfile = { ...f.bridge.currentProfile, adminScope: 'assigned' }; },
    f => { f.bridge.currentProfile = { ...f.bridge.currentProfile, loginDisabled: true }; }
  ]) {
    const f = fixture(); let resolve;
    f.bridge.db.collection = () => ({ doc: () => ({ get: () => new Promise(done => { resolve = done; }) }) });
    const pending = f.run();
    change(f);
    resolve({ exists: true, data: () => ({ payload: { pdfLabResetToken: 'late-token' } }) });
    assert.equal(await pending, false);
    assert.equal(f.applied.length, 0, 'Late responses after logout or loss of scope must not clear local work');
  }
  const denied = fixture();
  denied.bridge.db.collection = () => ({ doc: () => ({ get: async () => { throw Error('permission-denied'); } }) });
  await assert.rejects(denied.run(), /permission-denied/, 'Unexpected server denials must remain visible');
  console.log('PASS: global reset scope, disabled accounts, full-admin compatibility and late response isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
