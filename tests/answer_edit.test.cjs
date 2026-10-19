const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=require('./app_vm.cjs');
(async()=>{
 for(const file of ['app/index.html','app/final_test.html','app/general_exam.html']) {
  const {context:c,run,pure,constant}=load(file);
  const payload=JSON.parse(fs.readFileSync('tests/fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json','utf8'));
  c.record=run('PDFLabCanonical.create').call(null,payload.problems[0],payload,'source','fixture.json',{recordId:'r',sourceId:'source',kind:'problem'});
  const original=JSON.stringify(c.record.canonical);
  c.records=[c.record];
  const edit=pure('parseExamAnswerEditText("1. 정답: ②\\n해설: Updated",records)');
  assert.equal(edit[0].answerText,'②',file+' must parse new answer');
  c.records=[{recordId:'s',kind:'problem',number:1,isSubjective:true,textOnly:true}];
  const free=pure('parseExamAnswerEditText("1. 정답: We learn together.\\nSecond line.\\n해설: Explanation",records)');
  assert.equal(free[0].answerText,'We learn together.\nSecond line.',file+' must retain subjective spacing');
  c.state={examBuilder:{answerEditSlotId:'slot',answerEditDraftText:'1. 정답: ②\n해설: Updated'},libraryCache:{problemRecords:[c.record],imports:[]}};
  c.elements={};
  for(const n of ['LIBRARY_PROBLEM_STORE','LIBRARY_IMPORT_STORE'])constant(n);
  run('getExamSlot=()=>({});getEditableExamRecordsForSlot=()=>state.libraryCache.problemRecords;setBusy=()=>{};setStatus=()=>{};setOptionalText=()=>{};renderExamSlots=()=>{};syncLibraryFolderFromStateIfConnected=async()=>{};saveProblemMetadataRecordsToSharedFirebaseLibrary=async()=>({synced:false,reason:"isolated test"});openLibraryDb=async()=>({transaction:()=>({objectStore:()=>({put:()=>{}})})});idbTransactionDone=async()=>{}');
  await run('saveExamAnswerEditorChanges()');
  c.saved=c.state.libraryCache.problemRecords[0];
  assert.equal(c.saved.canonical.answerText,'②');assert.equal(c.saved.canonical.explanationText,'Updated');
  assert.equal(run('PDFLabCanonical.textRuntime(saved,1).answerText'),'②');
  const before=JSON.parse(original);const after={...c.saved.canonical,answerText:before.answerText,explanationText:before.explanationText};
  assert.deepEqual(JSON.parse(JSON.stringify(after)),before,'Other canonical fields must not change');
 }
 console.log('PASS: answer edit parse/save/runtime agree on all screens; subjective spacing and canonical provenance preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
