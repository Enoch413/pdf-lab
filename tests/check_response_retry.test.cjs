const assert=require('node:assert/strict');
const load=require('./app_vm.cjs');
const app=load(),c=app.context;
const mapping=[{questionId:'q1',problemRecordId:'p1'},{questionId:'q2',problemRecordId:'p2'}];
let checks=0;const failures=[];
function test(label,fn){checks++;try{fn();}catch(e){failures.push({label,message:e.message});}}
function apply(answers,mappings=mapping,results=['wrong','wrong']){
 c.round={updatedAt:1,items:results.map((result,i)=>({problemRecordId:'p'+(i+1),result}))};c.record={questionMappings:mappings};c.response={answers};
 const changed=app.pure('applyCheckResponseToRetryRound(round,record,response)');
 return {changed,results:Array.from(c.round.items,i=>i.result),timestamp:c.round.updatedAt};
}
test('missing answer stays wrong and remains a second-round candidate',()=>{
 const r=apply([{questionId:'q1',isCorrect:false}]);assert.deepEqual(r.results,['wrong','wrong']);assert.equal(r.changed,false);assert.equal(r.timestamp,1);
 assert.deepEqual(Array.from(c.round.items.filter(i=>i.result==='wrong'),i=>i.problemRecordId),['p1','p2']);
});
test('partial correction changes only the graded question',()=>assert.deepEqual(apply([{questionId:'q1',isCorrect:true}]).results,['correct','wrong']));
for(const value of [undefined,null,'false','true',0,1])test('ungraded value '+String(value),()=>assert.deepEqual(apply([{questionId:'q1',isCorrect:value}]).results,['wrong','wrong']));
test('empty and unmapped answers do not change results',()=>{
 for(const answers of [[],[{questionId:'unknown',isCorrect:true}],null])assert.deepEqual(apply(answers).results,['wrong','wrong']);
});
test('normal complete submission preserves explicit self-grading',()=>assert.deepEqual(apply([{questionId:'q1',isCorrect:true},{questionId:'q2',isCorrect:false}],mapping,['wrong','correct']).results,['correct','wrong']));
test('answer correction is repeatable and idempotent',()=>{
 apply([{questionId:'q1',isCorrect:false}]);c.response={answers:[{questionId:'q1',isCorrect:true}]};
 assert.equal(app.pure('applyCheckResponseToRetryRound(round,record,response)'),true);
 const time=c.round.updatedAt;assert.equal(app.pure('applyCheckResponseToRetryRound(round,record,response)'),false);assert.equal(c.round.updatedAt,time);
});
test('mapping ambiguity does not update either problem',()=>assert.deepEqual(apply([{questionId:'q1',isCorrect:true}],[{questionId:'q1',problemRecordId:'p1'},{questionId:'q1',problemRecordId:'p2'}]).results,['wrong','wrong']));
test('many questions per problem require all graded true for correct',()=>{
 const m=[{questionId:'q1',problemRecordId:'p1'},{questionId:'q2',problemRecordId:'p1'}];
 assert.equal(apply([{questionId:'q1',isCorrect:true}],m).results[0],'wrong');
 assert.equal(apply([{questionId:'q1',isCorrect:true},{questionId:'q2',isCorrect:true}],m).results[0],'correct');
 assert.equal(apply([{questionId:'q1',isCorrect:false},{questionId:'q2',isCorrect:true}],m,['correct','correct']).results[0],'wrong');
});
test('conflicting duplicate answers cannot mark a problem correct',()=>assert.equal(apply([{questionId:'q1',isCorrect:true},{questionId:'q1',isCorrect:false}]).results[0],'wrong'));
test('legacy answer id still matches a mapping',()=>assert.deepEqual(apply([{id:'q1',isCorrect:true}]).results,['correct','wrong']));
for(const corrected of [false,true])test('actual second-round generation preserves missing answers; corrected='+corrected,()=>{
 apply([{questionId:'q1',isCorrect:corrected}]);c.round.roundIndex=1;
 c.studentState={rounds:[c.round]};c.student={studentId:'student',name:'Synthetic'};c.session={sessionId:'session',name:'Synthetic'};
 c.state={examBuilder:{slots:[]},schoolWorkflow:{}};
 c.elements=Object.fromEntries(['examObjectiveCountInput','examSubjectiveCountInput','examTailCountInput','examKickerInput','examTitleInput','examSubtitleInput'].map(k=>[k,{}]));
 app.constant('EXAM_SLOT_RENDER_BATCH_SIZE');
 app.run('getSelectedRetryStudent=()=>student;getSelectedRetrySession=()=>session;getStudentRetryState=()=>studentState;getStudentRetryUsedProblemIds=()=>new Set();findNextRetryCandidateForItem=item=>({recordId:item.problemRecordId+"-next"});createRetryItemFromRecord=record=>({problemRecordId:record.recordId,result:"wrong"});getRetryRecordById=id=>({recordId:id});createSchoolDraftSlotFromRecord=record=>({category:"objective",assignedProblemId:record.recordId});createRetryId=()=>"synthetic-round";canUseFirebaseStudentRetryStorage=()=>false');
 for(const name of ['writeStudentRetryState','cleanupExamPreviewUrls','cleanupExamExportUrls','clearExamAnswerEditorState','renderExamSlots','renderStudentRetryPanel','revealSchoolDraftResult','setStatus'])app.run(name+'=()=>{}');
 app.run('generateNextStudentRetryRound()');
 assert.deepEqual(Array.from(c.studentState.rounds[1].items,i=>i.problemRecordId),corrected?['p2-next']:['p1-next','p2-next']);
});
if(failures.length)console.error(JSON.stringify({failures}));
assert.equal(failures.length,0,`${failures.length} response retry regressions failed`);
console.log(JSON.stringify({checkResponseRetryPassed:checks,productionAccess:false}));
