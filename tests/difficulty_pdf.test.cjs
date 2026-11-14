const assert = require('node:assert/strict');
const app = require('./app_vm.cjs')(undefined, { crypto: require('node:crypto').webcrypto });
const c = app.context;
c.records = ['topic', 'factual', 'unfactual', 'grammar_underline'].flatMap(type =>
  (type === 'grammar_underline' ? [''] : ['easy', 'medium', 'hard']).flatMap(difficulty =>
    [1, 2, 3].map(retryRound => ({ kind: 'problem', recordId: `${type}-${difficulty}-${retryRound}`, sourceId: 'source',
      passageKey: 'passage', problemType: type.includes('factual') ? '내용' : type, retryMode: 'rounds', retryRound, difficulty,
      retryGroupId: JSON.stringify(['unit.json', 'passage', type, difficulty]) }))));
c.state = { libraryCache: { problemRecords: c.records }, examBuilder: { slots: [{}] } };
c.entries = c.records.filter(r => r.retryRound === 1).map((record, slotIndex) => ({ record, slotIndex }));
app.run('getExamSlotAssignedRecords=()=>entries; validateExamBuilderForExport=()=>{}');
let before = JSON.stringify(c.state);
const batch = app.pure('buildDifficultyPdfPlans()');
assert.deepEqual(Array.from(batch.plans, p => p.questionCount), [1, 4, 4, 4]);
assert.deepEqual(Array.from(batch.plans[1].entries, e => e.record.recordId), ['topic-easy-1', 'factual-easy-1', 'unfactual-easy-1', 'grammar_underline--1']);
assert.equal(JSON.stringify(c.state), before);
c.entries = c.entries.filter(e => e.record.problemType !== 'grammar_underline');
assert.deepEqual(Array.from(app.pure('buildDifficultyPdfPlans().skipped')), ['공통']);
c.state.libraryCache.problemRecords = c.records.filter(r => r.recordId !== 'topic-hard-1');
assert.throws(() => app.pure('buildDifficultyPdfPlans()'), /대응 1차 문항이 0개/);
c.state.libraryCache.problemRecords = c.records;
c.entries = [{ record: c.records[1] }];
assert.throws(() => app.pure('buildDifficultyPdfPlans()'), /1차 문제 초안/);
c.records = [{ recordId: 'general', kind: 'problem', retryMode: 'general', answerText: '①' }];
c.state.libraryCache.problemRecords = c.records;
c.entries = c.records.map(record => ({ record }));
assert.equal(app.pure('buildDifficultyPdfPlans().plans.length'), 1, 'general JSON exports once as common, without duplicate levels');
// Array replacement, append and removal must invalidate the local lookup index.
assert.equal(app.run('getRetryRecordById("general").recordId'), 'general');
c.records.push({ recordId: 'new', kind: 'problem', retryMode: 'general' });
assert.equal(app.run('getRetryRecordById("new").recordId'), 'new');
c.state.libraryCache.problemRecords = [{ recordId: 'general', kind: 'problem', promptText: 'edited' }];
assert.equal(app.run('getRetryRecordById("new")'), null);
assert.equal(app.run('getRetryRecordById("general").promptText'), 'edited');
c.state.libraryCache = { problemRecords: [] };
assert.equal(app.run('getRetryRecordById("general")'), null, 'switching cache/account cannot retain an old record');
console.log('PASS: 4 difficulty plans, actual order/polarity/common mapping, general-only, empty common skip, missing-level preflight, later-round guard, nonmutation and lookup invalidation');
