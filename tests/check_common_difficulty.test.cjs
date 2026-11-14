const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('./app_vm.cjs')(), c = app.context;
// Real JSON adapter: ordinary levelled types plus a common-only type.
c.input = ['easy','medium','hard'].flatMap(difficulty => [1,2,3].map(n => ({ type:'topic',difficulty,stem:'Choose.',body:`Topic ${n}`,answer:'①' })))
  .concat([1,2,3].map(n => ({type:'grammar_box',difficulty:null,stem:'Choose.',body:`Common ${n}`,answer:'②'})));
c.problems = app.pure('assignJsonRetrySeries(createTextProblemsFromAiJsonItems(input,"QA","neoreunteo","qa.json"),input,"rounds","qa.json")');
c.records = c.problems.map((problem,index) => ({ ...problem,recordId:'r'+index,sourceId:'source',passageKey:'passage' }));
c.state = { libraryCache:{problemRecords:c.records}, schoolWorkflow:{} };
c.baseItems = [c.records[6],c.records[9]].map((record,index) => app.pure(`createRetryItemFromRecord(records[${c.records.indexOf(record)}],${index+1})`));
const before = JSON.stringify(c.records);
const common = app.pure('buildStudentDifficultyFirstRoundItems(baseItems,"none")');
assert.deepEqual(Array.from(common,item=>item.problemRecordId),['r9'],'common-only selection excludes levelled families without common variants');
assert.equal(common[0].displayNumber,1,'filtered first-round numbering matches the generated CHECK/PDF');
for(const level of ['easy','medium','hard']) {
  c.level=level;
  const items=app.pure('buildStudentDifficultyFirstRoundItems(baseItems,level)');
  assert.equal(items.length,2);
  assert.equal(items[0].difficulty,level);
  assert.equal(items[1].problemRecordId,'r9','common-only types are included in every level');
  c.item={problemRecordId:items[1].problemRecordId};c.used=new Set();
  app.run('doesRetryCandidateMatchItemSource = () => true');
  assert.equal(app.pure('findNextRetryCandidateForItem(item,used).recordId'),'r10');
  c.item.problemRecordId='r10';
  assert.equal(app.pure('findNextRetryCandidateForItem(item,used).recordId'),'r11');
}
assert.equal(JSON.stringify(c.records),before,'existing retry IDs/metadata are not migrated or rewritten');
for(const alias of ['',null,'none','common','공통','미지정','unspecified']) {c.alias=alias;assert.equal(app.run('normalizeSchoolDifficulty(alias)'),'none');}
assert.equal(app.run('getSchoolDifficultyLabel("none")'),'공통');
c.baseItems=c.baseItems.slice(0,1);
assert.throws(()=>app.pure('buildStudentDifficultyFirstRoundItems(baseItems,"none")'),/공통.*없/);
// A genuinely missing level with no common counterpart remains an error.
c.state.libraryCache.problemRecords=c.records.filter(record=>record.recordId!=='r0');
assert.throws(()=>app.pure('buildStudentDifficultyFirstRoundItems(baseItems,"easy")'),/대응/);
// Different student counts must keep the actual question/type/answer mapping after common filtering.
c.state.libraryCache.problemRecords=c.records;
c.entries=[{record:c.records[6],slotIndex:0},{record:c.records[9],slotIndex:1}];
c.students=['Common','Hard'].map((name,index)=>({name,studentId:'s'+index,firebaseUid:'uid'+index,schoolKey:'qa',classIds:['qa-class']}));
Object.assign(c.state,{schoolWorkflow:{selectedSchoolKey:'qa',sourceFilterKey:'all',draftMode:'distinct'},
  examBuilder:{slots:[],checkSetDifficulties:[{studentId:'s0',difficulty:'none'},{studentId:'s1',difficulty:'hard'}]},studentRetry:{students:c.students,sessions:[]}});
c.elements=Object.fromEntries(Object.entries({examCheckSetTitleInput:'Common QA',examCheckSetIdInput:'common-qa',examCheckSetDescriptionInput:'',examCheckSetClassIdsInput:'qa-class'}).map(([key,value])=>[key,{value}]));
app.run('getCurrentExamCheckSetQuestionEntries=()=>entries;getSelectedSchoolProfile=()=>({name:"QA"});getCheckSetTargetStudentsForSummary=()=>students');
const batch=app.pure('prepareDifficultyCheckBatch()');
assert.deepEqual(Array.from(batch.personalDrafts,draft=>draft.questions.length),[1,2]);
assert.equal(batch.personalDrafts[0].questionMappings[0].problemRecordId,'r9');
assert.equal(batch.personalDrafts[0].questionMappings[0].typeLabel,app.pure('getRecordTypeLabel(records[9])'));
assert.equal(batch.personalDrafts[0].questions[0].answer,'2');
assert.equal(batch.session.studentStates.s0.rounds[0].items[0].displayNumber,1);
assert.deepEqual(Array.from(batch.personalDrafts[0].exportPayload.targetUserIds),['uid0']);
if(process.env.PDFLAB_JSON_CHECK_DIR) {
  let count=0,commonCount=0;
  for(const name of fs.readdirSync(process.env.PDFLAB_JSON_CHECK_DIR).filter(name=>name.endsWith('.json'))) {
    c.input=JSON.parse(fs.readFileSync(path.join(process.env.PDFLAB_JSON_CHECK_DIR,name),'utf8').replace(/^\uFEFF/,''));
    c.filename=name;
    c.problems=app.pure('assignJsonRetrySeries(createTextProblemsFromAiJsonItems(input,"QA","neoreunteo",filename),input,"rounds",filename)');
    c.records=c.problems.map((problem,index)=>({...problem,recordId:'p'+index,sourceId:'qa',passageKey:'passage'}));
    c.state.libraryCache.problemRecords=c.records;
    c.baseItems=app.pure('getCheckDifficultyBaseEntries(records.filter(record=>record.retryRound===1).map(record=>({record}))).map((entry,index)=>createRetryItemFromRecord(entry.record,index+1))');
    const expected=app.pure('records.filter(record=>record.retryRound===1 && normalizeSchoolDifficulty(record.difficulty)==="none").length');
    if(expected) {assert.equal(app.pure('buildStudentDifficultyFirstRoundItems(baseItems,"none").length'),expected);commonCount+=expected;}
    for(const level of ['easy','medium','hard']) {c.level=level;assert.equal(app.pure('buildStudentDifficultyFirstRoundItems(baseItems,level).length'),c.baseItems.length);}
    count++;
  }
  console.log(`PASS: ${count} supplied JSONs, ${commonCount} common first-round questions, all three levels include their common types`);
}
console.log('PASS: common-only selection, common fallback for levels, numbering, aliases, missing-level errors and original common 1/2/3 retry pairing');
