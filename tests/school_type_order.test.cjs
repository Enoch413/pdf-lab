const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');
const app = load(), c = app.context;
const types = ['주제', '제목', '요지', '주장', '함축의미', '빈칸', '요약', '내용일치', '내용불일치', '밑줄어휘', '선택어휘', '밑줄어법', '선택어법', '순서', '삽입', '무관문'];
c.records = ['B', 'A'].flatMap(passageKey => [...types].reverse().map((type, index) => ({
  recordId: passageKey + '-' + type, passageKey, number: index + 1, kind: 'problem',
  problemType: type.startsWith('내용') ? '내용' : type,
  textStructure: { questionText: type === '내용불일치' ? '다음 글의 내용과 일치하지 않는 것은?' : '다음 글의 내용과 일치하는 것은?' },
  answerText: passageKey + '-' + type
})));
c.state = { schoolWorkflow: {
  selectedPassageKeys: ['B', 'A'], selectedTypeLabels: [...types].reverse().map(type => type.startsWith('내용') ? '내용' : type),
  excludeUsedProblems: false, excludeUsedPassageTypes: false
}, examBuilder: {} };
app.pure('PROBLEM_TYPE_OPTIONS');
// Match the real selection UI, which merges factual/unfactual into one content filter.
c.state.schoolWorkflow.selectedTypeLabels = [...new Set(c.state.schoolWorkflow.selectedTypeLabels.map(t => app.pure('normalizeEffectiveProblemType(' + JSON.stringify(t) + ')')))];
c.summaries = ['B', 'A'].map(passageKey => ({ passageKey, availableTypes: c.state.schoolWorkflow.selectedTypeLabels }));
app.run(`getSchoolPassageSummaries = () => summaries;
  getSchoolProblemRecordsOnly = () => records;
  getProblemRecordsOnly = () => records;
  getSchoolPassageUsageCounts = () => new Map();
  createSchoolDraftSlotFromRecord = (record, order) => ({ id: record.recordId, category: 'objective', selectedType: getRecordTypeLabel(record), assignedProblemId: record.recordId });`);
for (const outputOrder of ['type', 'passage']) for (const builder of ['buildSchoolFullDraft', 'buildSchoolDistinctDraft']) {
  c.state.schoolWorkflow.outputOrder = outputOrder;
  const original = JSON.stringify(c.records);
  const result = app.pure(builder + '()');
  c.state.examBuilder.slots = result.slots;
  const entries = app.pure('getExamSlotAssignedRecords()');
  const selectedTypes = builder === 'buildSchoolFullDraft' ? types : types.filter(t => t !== '내용일치');
  const expected = outputOrder === 'passage'
    ? ['B', 'A'].flatMap(p => selectedTypes.map(t => p + '-' + t))
    : selectedTypes.flatMap(t => ['B-' + t, 'A-' + t]);
  assert.deepEqual(Array.from(entries, e => e.record.recordId), expected, outputOrder + ' / ' + builder);
  assert.equal(JSON.stringify(c.records), original, 'sorting must not change library records');
  assert.equal(result.warnings.length, 0);
}
c.state.schoolWorkflow.outputOrder = 'type';
// Canonical, legacy labels and stems share the same factual/unfactual ordering.
c.records = [
  { recordId: 'negative', problemType: '내용', canonical: { problemType: '내용', questionText: '내용과 일치하지 않는 것은?' } },
  { recordId: 'positive', problemType: '내용', canonical: { problemType: '내용', questionText: '내용과 일치하는 것은?' } },
  { recordId: 'legacy-negative', problemType: '내용 불일치' },
  { recordId: 'legacy-positive', problemType: '내용일치' },
  { recordId: 'extra', problemType: '연결사' },
  { recordId: 'tail', problemType: '꼬리문제' }
];
c.slots = c.records.map(r => ({ id: r.recordId, selectedType: r.problemType, assignedProblemId: r.recordId, assignedProblemIds: r.recordId === 'tail' ? ['child-1', 'child-2'] : [r.recordId] }));
const originalSlots = JSON.stringify(c.slots);
const ordered = app.pure('sortSchoolDraftSlots(slots)');
assert.deepEqual(Array.from(ordered, s => s.id), ['positive', 'legacy-positive', 'negative', 'legacy-negative', 'extra', 'tail']);
assert.deepEqual(ordered.at(-1).assignedProblemIds, ['child-1', 'child-2'], 'tail pack remains intact');
assert.equal(JSON.stringify(c.slots), originalSlots, 'sort must not mutate existing slots');
// Switching order reuses the exact questions and edits, and detaches saved history.
c.records = ['B', 'A'].flatMap(p => ['제목', '주제'].map(t => ({ recordId: p + t, passageKey: p, problemType: t })));
c.state.examBuilder = { slots: c.records.map(r => ({ id: r.recordId, selectedType: r.problemType, assignedProblemId: r.recordId })), loadedExamId: 'saved-exam', loadedWorkId: 'saved-work', answerEditSlotId: 'B제목', answerEditDraftText: 'unsaved answer' };
c.elements = { schoolOutputOrderSelect: {} };
c.retryActive = false;
app.run(`isStudentRetryDraftActive = () => retryActive;
  cleanupExamPreviewUrls = () => {}; cleanupExamExportUrls = () => {};
  renderExamSlots = () => {}; setStatus = () => {};`);
app.pure('EXAM_SLOT_RENDER_BATCH_SIZE');
app.pure('setSchoolOutputOrder("passage")');
assert.deepEqual(Array.from(c.state.examBuilder.slots, s => s.id), ['B주제', 'B제목', 'A주제', 'A제목']);
assert.equal(c.state.examBuilder.answerEditDraftText, 'unsaved answer');
assert.equal(c.state.examBuilder.loadedExamId, '');
assert.equal(c.state.examBuilder.loadedWorkId, '');
c.retryActive = true;
const retrySlots = JSON.stringify(c.state.examBuilder.slots);
app.pure('setSchoolOutputOrder("type")');
assert.equal(JSON.stringify(c.state.examBuilder.slots), retrySlots, 'retry numbering must remain intact');
assert.equal(c.state.schoolWorkflow.outputOrder, 'passage');
assert.equal(c.elements.schoolOutputOrderSelect.value, 'passage');

// Saved work round-trips the setting; legacy records fall back without reordering.
app.run(`getSchoolSourceFilterKey = () => 'all'; applySelectedSchoolClassIdsToCheckSetInput = () => {};`);
Object.assign(c.state.schoolWorkflow, { selectedSchoolKey: '', warnings: [], sourceFilterKey: 'all' });
const snapshot = JSON.parse(JSON.stringify(app.pure('captureSchoolWorkflowSnapshot()')));
assert.equal(snapshot.outputOrder, 'passage');
c.snapshot = snapshot;
app.pure('applySchoolWorkflowSnapshot(snapshot)');
assert.equal(c.state.schoolWorkflow.outputOrder, 'passage');
app.pure('applySchoolWorkflowSnapshot({})');
assert.equal(c.state.schoolWorkflow.outputOrder, 'type');
assert.equal(c.elements.schoolOutputOrderSelect.value, 'type');
assert.equal(JSON.stringify(c.state.examBuilder.slots), retrySlots, 'restoring old settings must not reorder saved questions');
console.log('PASS: passage/type order in both draft modes, content polarity, groups, nonmutation, switching without losing edits, retry protection and saved settings');
