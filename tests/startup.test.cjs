const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const loadApp = require('./app_vm.cjs');

function uiFixture(page) {
  const timers = new Map(); let id = 0, reloads = 0;
  function node(id) {
    return { id, hidden: false, inert: false, textContent: '', dataset: {}, attrs: {}, children: [],
      classList: { toggle() {}, add() {} },
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(name, fn) { this[name] = fn; },
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; } };
  }
  const nodes = Object.fromEntries(['statusBar', 'statusCopy', 'statsPill', 'repackTabPanel', 'examBuilderTabPanel'].map(id => [id, node(id)]));
  const slot = node('slot');
  const document = { body: { dataset: { uiPage: page } },
    querySelectorAll: () => [nodes.repackTabPanel, nodes.examBuilderTabPanel],
    getElementById: id => nodes[id], querySelector: () => slot, createElement: () => node('retry') };
  const context = { document, console: { error() {} },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    location: { reload() { reloads++; } } };
  vm.runInNewContext(fs.readFileSync('app/workspace_ui.js', 'utf8'), context);
  const ui = context.PDFLabWorkspaceUI;
  return { ui, document, nodes, slot, timers, reloads: () => reloads };
}

(async () => {
  for (const page of ['exam', 'library', 'final']) {
    const f = uiFixture(page), startup = f.ui.prepareStartup();
    assert.equal(f.nodes.repackTabPanel.hidden, page !== 'library');
    assert.equal(f.nodes.examBuilderTabPanel.hidden, page === 'library');
    assert.equal(f.slot.children[0], f.nodes.statusBar, 'Status must be visible before SDK/data initialization');
    assert(f.nodes.repackTabPanel.inert, 'Block edits while stored data is still being restored');
    let complete, saved = 0;
    const busy = [];
    const running = startup.run(report => { report('로컬 저장소 확인'); return new Promise(resolve => { complete = resolve; }); },
      { setBusy: value => busy.push(value), onLoaded: () => saved++, readyMessage: '준비됨' });
    assert.equal(f.document.body.dataset.dataReady, 'loading');
    [...f.timers.values()][0]();
    const retry = f.nodes.statusBar.children[0];
    assert(!retry.hidden, 'A stalled read must expose recovery without hiding the page');
    assert.match(f.nodes.statusCopy.textContent, /로컬 저장소 확인.*지연/);
    retry.click(); assert.equal(f.reloads(), 1);
    complete(); await running;
    assert.equal(f.document.body.dataset.dataReady, 'true');
    assert(!f.nodes.repackTabPanel.inert); assert.equal(saved, 1);
    assert.deepEqual(busy, [true, false]); assert.equal(f.timers.size, 0);
    const failed = uiFixture(page), failedStartup = failed.ui.prepareStartup();
    await failedStartup.run(async () => { throw Error('저장소 잠김'); },
      { setBusy() {}, onLoaded() { assert.fail('Do not mark failed hydration as saved'); }, readyMessage: '' });
    assert.equal(failed.document.body.dataset.dataReady, 'error');
    assert(failed.nodes.repackTabPanel.inert, 'Do not allow writes after failed hydration');
    assert.match(failed.nodes.statusCopy.textContent, /저장소 잠김/);
  }

  const f = uiFixture('library');
  let finishRead;
  const pending = new Promise(resolve => { finishRead = resolve; });
  const bounded = f.ui.readWithTimeout(pending, '공용 문항');
  [...f.timers.values()][0]();
  await assert.rejects(bounded, /공용 문항.*지연/);
  finishRead({ documents: ['late response'] });
  assert.equal(f.timers.size, 0);
  assert.equal(await f.ui.readWithTimeout(Promise.resolve(7), '조회'), 7);
  assert.equal(f.timers.size, 0);

  for (const file of ['app/index.html', 'app/final_test.html']) {
    const timers = new Map(); let timerId = 0, openCount = 0, closed = 0, aborted = 0;
    let request;
    const db = { close() { closed++; }, addEventListener(name, fn) { this[name] = fn; } };
    const app = loadApp(file, { window: {
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
      indexedDB: { open() { openCount++; request = { result: db, transaction: { abort() { aborted++; } },
        addEventListener(name, fn) { this[name] = fn; } }; return request; } }
    } });
    app.constant('LIBRARY_DB_NAME'); app.constant('LIBRARY_DB_VERSION');
    app.run('var libraryDbPromise = null');
    let opening = app.run('openLibraryDb()');
    request.blocked(); await assert.rejects(opening, /다른 PDF LAB 탭/);
    request.upgradeneeded(); assert(aborted > 0, 'Do not run a late migration after failure');
    request.success(); assert.equal(closed, 1, 'Discard a late database connection');
    opening = app.run('openLibraryDb()'); assert.equal(openCount, 2, 'Retry must not reuse a rejected open promise');
    request.success(); assert.equal(await opening, db); assert.equal(timers.size, 0);
    db.versionchange(); assert.equal(closed, 2);
    opening = app.run('openLibraryDb()');
    [...timers.values()][0](); await assert.rejects(opening, /저장소가 응답하지/);
    app.context.PDFLabWorkspaceUI = app.context.window.PDFLabWorkspaceUI;
    app.context.readRequest = { addEventListener() {} };
    const reading = app.run('idbRequestToPromise(readRequest)');
    [...timers.values()][0](); await assert.rejects(reading, /브라우저 저장소 조회.*지연/);
    const wire = app.run('wireEvents.toString()');
    assert(!wire.slice(0, wire.indexOf('addEventListener')).includes('await '), 'No storage/network await before wiring controls');
    assert(app.html.indexOf('prepareStartup()') < app.html.indexOf('https://www.gstatic.com/firebasejs/'), 'Show the correct panel before remote SDK scripts can stall');
  }
  const history = loadApp('app/index.html', { console: { warn() {} } });
  for (const name of ['FIREBASE_STUDENT_RETRY_EXAM_COLLECTION', 'FIREBASE_STUDENT_RETRY_EXAM_ITEM_COLLECTION', 'FIREBASE_STUDENT_RETRY_WORK_COLLECTION']) history.constant(name);
  history.context.bridge = { db: { collection: () => ({ where: () => ({ get: async () => { throw Error('injected offline'); } }) }) } };
  history.run('getFirebaseStudentRetryBridge = () => bridge; canUseFirebaseStudentRetryStorage = () => true; getFirebaseStudentRetryOwnerUid = () => "owner"');
  await assert.rejects(history.run('loadFirebaseStudentRetryOperationalSnapshot()'), /injected offline/, 'Failed history reads must not become an empty snapshot');
  console.log('PASS: visible UI during stalled hydration, recovery, bounded reads, late response safety, blocked database retry and versionchange');
})().catch(error => { console.error(error); process.exitCode = 1; });
