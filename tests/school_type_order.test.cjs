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
for (const builder of ['buildSchoolFullDraft', 'buildSchoolDistinctDraft']) {
  const original = JSON.stringify(c.records);
  const result = app.pure(builder + '()');
  c.state.examBuilder.slots = result.slots;
  const entries = app.pure('getExamSlotAssignedRecords()');
  const typeOrder = entries.map(e => e.record.recordId.replace(/^[AB]-/, ''));
  if (builder === 'buildSchoolFullDraft') {
    assert.deepEqual(Array.from(typeOrder), types.flatMap(t => [t, t]), 'all passages grouped by the requested 16-type order');
    assert.deepEqual(Array.from(entries.filter(e => e.record.recordId.endsWith('-주제')), e => e.record.passageKey), ['B', 'A'], 'retain passage order within a type');
  } else {
    // One candidate per content filter per passage; factual and unfactual must still be ranked correctly.
    const expected = types.filter(t => t !== '내용일치').flatMap(t => [t, t]);
    assert.deepEqual(Array.from(typeOrder), expected, 'distinct mode uses the same type priority');
  }
  assert.equal(JSON.stringify(c.records), original, 'sorting must not change library records');
  assert.equal(result.warnings.length, 0);
}
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
const ordered = app.pure('sortSchoolDraftSlotsByType(slots)');
assert.deepEqual(Array.from(ordered, s => s.id), ['positive', 'legacy-positive', 'negative', 'legacy-negative', 'extra', 'tail']);
assert.deepEqual(ordered.at(-1).assignedProblemIds, ['child-1', 'child-2'], 'tail pack remains intact');
assert.equal(JSON.stringify(c.slots), originalSlots, 'sort must not mutate existing slots');
console.log('PASS: 16-type priority across passages, full/distinct drafts, content polarity, stable ties, intact groups and nonmutation');
