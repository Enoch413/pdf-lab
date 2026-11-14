// Offline benchmark: no browser storage or Firebase access.
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const loadApp = require('./app_vm.cjs');
const app = loadApp(undefined, { crypto: require('node:crypto').webcrypto });
const records = [];
for (let family = 0; family < 1500; family++) {
  for (const difficulty of ['', 'easy', 'medium', 'hard']) {
    for (let round = 1; round <= 3; round++) records.push({
      kind: 'problem', recordId: `${family}:${difficulty}:${round}`, sourceId: 'benchmark',
      passageKey: `passage-${family}`, problemType: '주제', difficulty,
      retryMode: 'rounds', retryRound: round,
      retryGroupId: JSON.stringify(['benchmark.json', `passage-${family}`, 'topic', difficulty])
    });
  }
}
app.context.state = { libraryCache: { problemRecords: records }, schoolWorkflow: {} };
app.context.baseItems = records.filter(r => r.difficulty === 'hard' && r.retryRound === 1).slice(0, 160)
  .map((r, i) => ({ problemRecordId: r.recordId, displayNumber: i + 1 }));
app.pure('normalizeSchoolDifficulty("easy")');
const start = performance.now();
for (const level of ['none', 'easy', 'medium', 'hard']) {
  app.context.level = level;
  const items = app.pure('buildStudentDifficultyFirstRoundItems(baseItems,level)');
  assert.equal(items.length, 160);
}
console.log(JSON.stringify({ records: records.length, selectedFamilies: 160, difficulties: 4, milliseconds: Math.round(performance.now() - start) }));
