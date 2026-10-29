const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');

for (const file of ['app/index.html', 'app/final_test.html']) {
  const app = load(file), c = app.context;
  c.historySets = [];
  c.historyItems = [{ examId: 'synthetic', typeLabel: '독해' }];
  c.elements = { examHistoryEmptyState: {}, examHistoryList: { innerHTML: '' } };
  app.run(`getExamSetsForSelectedSchool = () => historySets;
    getExamItems = () => historyItems;
    getLibrarySourceLabel = () => '합성 출처';
    formatTimestamp = () => '합성 날짜';
    renderStudentRetryHistoryList = () => {};
    renderExamCheckSetList = () => {};`);
  const render = () => app.pure('renderExamHistoryList()');
  render();
  assert.equal(c.elements.examHistoryEmptyState.hidden, false);
  for (const [mode, expected] of [['text', '텍스트 출제'], ['image', '이미지 출제'], [undefined, '이미지 출제']]) {
    c.historySets = [{ examId: 'synthetic', title: '<합성 시험>', totalCount: 1, contentRenderMode: mode }];
    const before = JSON.stringify(c.historySets);
    assert.doesNotThrow(render, file + ': stored history must not prevent workspace startup');
    assert.equal(c.elements.examHistoryEmptyState.hidden, true);
    assert(c.elements.examHistoryList.innerHTML.includes(expected), file + ': ' + expected);
    assert(c.elements.examHistoryList.innerHTML.includes('&lt;합성 시험&gt;'));
    assert.equal(JSON.stringify(c.historySets), before, 'Rendering must not modify saved history');
  }
  c.historySets = [];
  render();
  assert.equal(c.elements.examHistoryList.innerHTML, '');
}
console.log('PASS: common history with text/image/legacy records, empty state, escaping and nonmutation in both apps');
