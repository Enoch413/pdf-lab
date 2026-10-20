const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');
const app = load();
const c = app.context;
const teacher = { role:'admin', adminScope:'classes', classIds:['a'] };
const user = { uid:'teacher' };
function record(overrides={}) {
  return { checkSetId:'contract-set', classIds:['a'], targetFirebaseUid:'alice', assignmentMode:'student',
    exportPayload:{ id:'contract-set', classIds:['a'], assignmentMode:'student', targetUserIds:['alice'], questions:[{id:'q1',type:'객관식',answer:'1'}] }, ...overrides };
}
function setup(profile=teacher, db={}) { c.state={firebaseSchoolBridge:{currentUser:user,currentProfile:profile,db}}; }
function build(value) { c.record=value; return app.pure('buildCodeLabPortalCheckSetDoc(record,"2026-10-20T00:00:00.000Z")'); }
function fakeDb() {
  const queries=[], writes=[];
  const db={queries,writes,collection:collection=>{
    const query=filters=>({where:(...args)=>query([...filters,args]),get:async options=>{
      queries.push({collection,filters,options});
      return {docs:[{id:'same',data:()=>({id:'forged'})}]};
    },doc:id=>({get:async()=>({id,exists:true,metadata:{fromCache:false},data:()=>({uid:'forged',role:'student',classIds:['a']})}),set:async data=>writes.push({id,data})})});
    return query([]);
  }};
  return db;
}
const failures=[];let checks=0;
async function test(label,fn) { checks++;try {await fn();}catch(error){failures.push({label,message:error.message});} }
(async()=>{
  setup();
  await test('canonical personal root and payload',()=>{
    const doc=build(record());
    for(const value of [doc,doc.payload]) {
      assert.equal(value.accessSchemaVersion,1);assert.equal(value.assignmentMode,'personal');
      assert.deepEqual(Array.from(value.classIds),['a']);assert.deepEqual(Array.from(value.targetUserIds),['alice']);
    }
  });
  await test('explicit class assignment has no personal targets',()=>{
    const doc=build(record({assignmentMode:'class',targetFirebaseUid:'',exportPayload:{questions:[],classIds:['a'],assignmentMode:'class'}}));
    assert.equal(doc.assignmentMode,'class');assert.equal(doc.targetUserIds.length,0);
  });
  for(const [label,value] of [
    ['UID required',record({targetFirebaseUid:'',exportPayload:{questions:[],classIds:['a'],assignmentMode:'student',targetStudentNames:['Same Name']}})],
    ['mixed classes rejected',record({classIds:['a','b']})],
    ['root payload class conflict rejected',record({exportPayload:{questions:[],classIds:['b'],targetUserIds:['alice']}})],
    ['root payload UID conflict rejected',record({exportPayload:{questions:[],classIds:['a'],targetUserIds:['bob']}})],
    ['unknown assignment rejected',record({assignmentMode:'unexpected',exportPayload:{questions:[],classIds:['a'],assignmentMode:'unexpected',targetUserIds:['alice']}})]
  ]) await test(label,()=>assert.throws(()=>build(value)));
  await test('multi-class drafts split into scoped personal documents',()=>{
    c.students=[{studentId:'local',name:'Synthetic',firebaseUid:'alice',classIds:['a','b']}];
    app.run('getCurrentStudentRetryDraftContext=()=>null;getCheckSetTargetStudentsForCurrentDraft=()=>students');
    c.draft={...record(),classIds:['a','b'],title:'Synthetic',questions:[],sourceRound:'round1'};
    const drafts=app.pure('buildPersonalExamCheckSetDrafts(draft)');
    assert.equal(drafts.length,2);assert.equal(new Set(drafts.map(d=>d.checkSetId)).size,2);
    for(const d of drafts) {assert.equal(d.classIds.length,1);assert.equal(d.assignmentMode,'personal');assert.equal(build(d).accessSchemaVersion,1);}
  });
  await test('draft class scope intersects student classes',()=>{
    c.students=[{studentId:'local',firebaseUid:'alice',classIds:['a']}];
    c.draft={...record({classIds:['a','b']}),questions:[]};
    const drafts=app.pure('buildPersonalExamCheckSetDrafts(draft)');
    assert.equal(drafts.length,1);assert.deepEqual(Array.from(drafts[0].classIds),['a']);
    c.students=[{studentId:'local',firebaseUid:'alice',classIds:['b']}];c.draft.classIds=['a'];
    assert.throws(()=>app.pure('buildPersonalExamCheckSetDrafts(draft)'));
  });
  await test('class ID normalization cannot silently overwrite a split draft',()=>{
    c.students=[{studentId:'local',firebaseUid:'alice',classIds:['A','a']}];
    c.draft={...record({classIds:['A','a']}),questions:[]};
    assert.throws(()=>app.pure('buildPersonalExamCheckSetDrafts(draft)'),/ID/);
  });
  await test('disabled profile survives normalization and scope signature',()=>{
    c.profile={...teacher,loginDisabled:true};
    assert.equal(app.pure('normalizeFirebaseSchoolUserProfile(profile)').loginDisabled,true);
    assert.notEqual(app.pure('createFirebaseProfileScopeSignature(profile)'),app.pure('createFirebaseProfileScopeSignature({...profile,loginDisabled:false})'));
  });
  await test('scoped queries chunk 31 classes and deduplicate document IDs',async()=>{
    const db=fakeDb();const profile={...teacher,classIds:Array.from({length:31},(_,i)=>'c'+i)};
    const docs=await c.PDFLabFirebase.loadClassScopedDocs(db,'portalCheckSets',profile,[['accessSchemaVersion','==',1]]);
    assert.equal(docs.length,1);
    assert.deepEqual(db.queries.map(q=>q.filters.find(f=>f[0]==='classIds')[2].length),[30,1]);
    assert.ok(db.queries.every(q=>q.options.source==='server'&&q.filters.some(f=>f[0]==='accessSchemaVersion'&&f[2]===1)));
  });
  await test('full admin keeps legacy query, empty scope and disabled/non-admin do not query',async()=>{
    const db=fakeDb();
    await c.PDFLabFirebase.loadClassScopedDocs(db,'portalCheckSets',{role:'admin',adminScope:'all'},[]);
    assert.equal(db.queries.length,1);assert.equal(db.queries[0].filters.length,0);
    for(const profile of [{...teacher,classIds:[]},{...teacher,loginDisabled:true},{role:'student',classIds:['a']}])
      assert.equal((await c.PDFLabFirebase.loadClassScopedDocs(db,'portalCheckSets',profile,[])).length,0);
    assert.equal(db.queries.length,1);
  });
  await test('query failures never retry without scope',async()=>{
    let attempts=0;const db={collection:()=>{const q={where:()=>q,get:async()=>{attempts++;throw Error('injected denial');}};return q;}};
    await assert.rejects(c.PDFLabFirebase.loadClassScopedDocs(db,'portalCheckSets',teacher,[['accessSchemaVersion','==',1]]),/injected denial/);
    assert.equal(attempts,1);
  });
  await test('response query includes server class scope and authoritative response ID',async()=>{
    const db=fakeDb();setup(teacher,db);
    app.run('doesRetryStudentMatchCheckResponse=()=>true');
    c.record=record();c.student={firebaseUid:'alice'};
    const result=await app.run('fetchLatestCheckResponseForRetryRoundRecord(record,student)');
    assert.equal(result.id,'same');
    assert.ok(db.queries[0].filters.some(f=>f[0]==='checkSetId'&&f[2]==='contract-set'));
    assert.ok(db.queries[0].filters.some(f=>f[0]==='classIds'&&f[1]==='array-contains-any'));
  });
  app.run('isPdfLabFirebaseConfigured=()=>true;ensurePdfLabFirebaseServices=()=>true');
  await test('preflight rejects a later invalid record before any writes',async()=>{
    const db=fakeDb();setup(teacher,db);c.records=[record(),record({checkSetId:'bad',classIds:['a','b']})];
    await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'));assert.equal(db.writes.length,0);
  });
  await test('duplicate IDs cannot overwrite another prepared document',async()=>{
    const db=fakeDb();setup(teacher,db);c.records=[record(),record()];
    await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'));assert.equal(db.writes.length,0);
  });
  for(const [label,student] of [['missing',{exists:false}],['disabled',{exists:true,role:'student',classIds:['a'],loginDisabled:true}],['other-class',{exists:true,role:'student',classIds:['b']}],['admin-target',{exists:true,role:'admin',classIds:['a']}]]) {
    await test('UID profile validation '+label,async()=>{
      const db=fakeDb();const original=db.collection;
      db.collection=name=>name==='users'?{doc:id=>({get:async()=>({id,exists:student.exists,metadata:{fromCache:false},data:()=>student})})}:original(name);
      setup(teacher,db);c.records=[record()];await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'));assert.equal(db.writes.length,0);
    });
  }
  await test('normal verified UID upload uses document identity',async()=>{
    const db=fakeDb();setup(teacher,db);c.records=[record()];
    const result=await app.run('uploadExamCheckSetRecordsToCodeLab(records)');
    assert.equal(result.uploaded,1);assert.equal(db.writes[0].data.targetUserIds[0],'alice');
  });
  await test('actor change during profile lookup cannot write',async()=>{
    const db=fakeDb();const original=db.collection;
    db.collection=name=>name==='users'?{doc:id=>({get:async()=>{c.state.firebaseSchoolBridge.currentUser={uid:'other'};return {id,exists:true,data:()=>({role:'student',classIds:['a']})};}})}:original(name);
    setup(teacher,db);c.records=[record()];await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'));assert.equal(db.writes.length,0);
  });
  await test('account change during material query cannot import old data',async()=>{
    let imports=0;const db={collection:()=>{const q={where:()=>q,get:async()=>{c.state.firebaseSchoolBridge.currentUser={uid:'other'};return {docs:[]};}};return q;}};
    setup(teacher,db);c.importRecords=async()=>{imports++;};
    app.run('getSelectedRetryStudent=()=>({firebaseUid:"alice"});getStudentRetrySessionSyncContextKey=()=>"query";upsertCheckSetRecordsFromFirebase=importRecords');
    const result=await app.run('syncStudentRetrySessionsFromFirebaseCheckSets({force:true})');
    assert.equal(result.reason,'account-changed');assert.equal(imports,0);
  });
  await test('account change during response query cannot mutate retry rounds',async()=>{
    setup(teacher,fakeDb());c.applied=0;
    app.run('getSelectedRetrySession=()=>({sessionId:"test"});getSelectedRetryStudent=()=>({studentId:"local"});getStudentRetryState=()=>({rounds:[{roundIndex:1}]});getRetryCheckSetRecordsForRound=()=>[{}];fetchLatestCheckResponseForRetryRoundRecord=async()=>{state.firebaseSchoolBridge.currentUser={uid:"other"};return {answers:[]};};applyCheckResponseToRetryRound=()=>{applied++;return true;}');
    const result=await app.run('syncSelectedStudentRetryResultsFromCheckResponses({force:true})');
    assert.equal(result.reason,'account-changed');assert.equal(c.applied,0);
  });
  if(failures.length)console.error(JSON.stringify({failures}));
  assert.equal(failures.length,0,`${failures.length} CHECK contract regressions failed`);
  console.log(JSON.stringify({checkContractPassed:checks,productionAccess:false}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
