const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');
const warnings=[];
const { context:c, run, constant } = load('app/index.html',{console:{...console,warn:(...args)=>warnings.push(args)}});
function fakeDb(failAt = 0) {
  const batches=[], writes=[]; let commits=0;
  return {batches,writes,get commits(){return commits;},
    collection:name=>({doc:id=>({path:name+'/'+id,set:async data=>writes.push({path:name+'/'+id,data})})}),
    batch:()=>{const rows=[];batches.push(rows);return {set:(ref,data,options)=>rows.push({ref,data,options}),delete:ref=>rows.push({ref,type:'delete'}),commit:async()=>{if(++commits===failAt)throw Error('injected commit failure');}};}};
}
(async()=>{
  const helper=c.PDFLabFirebase;
  let db=fakeDb();
  const operations=Array.from({length:2307},(_,i)=>({ref:{path:'problems/'+i},data:{text:'문제 '+i},options:{merge:true}}));
  assert.equal(await helper.commitOperations(db,operations),2307);
  assert.deepEqual(db.batches.map(b=>b.length),[450,450,450,450,450,57]);
  assert.ok(db.batches.every(b=>b.every(row=>row.options.merge)));
  db=fakeDb();
  await helper.commitOperations(db,Array.from({length:20},(_,i)=>({ref:{path:String(i)},data:{text:'한'.repeat(100000)}})));
  assert.ok(db.commits>1,'UTF-8 byte budget must split below the count limit');
  db=fakeDb();
  await assert.rejects(helper.commitOperations(db,[...operations,{ref:{path:'too-large'},data:{text:'x'.repeat(950*1024)}}]),/크기 제한/);
  assert.equal(db.commits,0,'All documents must pass size validation before the first write');
  db=fakeDb(2);await assert.rejects(helper.commitOperations(db,operations),/injected/);
  assert.equal(db.commits,2,'Stop after the failed batch');
  const queries=[];
  const users={where:(field,operator,ids)=>({get:async()=>{queries.push({field,operator,ids});return {docs:[{id:'student',data:()=>({})}]};}}),get:async()=>{queries.push('all');return {docs:[]};}};
  const ids=Array.from({length:31},(_,i)=>'c'+i);
  const docs=await helper.loadUserCatalog({collection:()=>users},{uid:'teacher',adminScope:'classes'},ids);
  assert.deepEqual(queries.map(q=>q.ids.length),[30,1]);
  assert.equal(docs.length,2,'Preserve own profile, deduplicate overlapping class queries');
  queries.length=0;await helper.loadUserCatalog({collection:()=>users},{uid:'teacher',adminScope:'classes'},[]);assert.equal(queries.length,0);
  await helper.loadUserCatalog({collection:()=>users},{uid:'admin',adminScope:'all'},[]);assert.deepEqual(queries,['all']);
  for (const file of ['app/index.html','app/final_test.html']) {
    const app=load(file);
    const messageFunction=file.endsWith('index.html')?'getFriendlyFirebaseAuthMessage':'getFriendlyFirebaseMessage';
    for (const hostname of ['enoch413.github.io','localhost','127.0.0.1']) {
      app.context.window={location:{hostname}};
      const message=app.run(`${messageFunction}({code:"auth/unauthorized-domain"})`);
      assert.ok(message.includes(`현재 도메인(${hostname})`));
      assert.ok(message.includes(`domains에 ${hostname}을 추가`));
    }
    app.run('normalizeFirebaseSchoolUserProfile = value => value');
    app.context.db={collection:()=>({doc:()=>({get:async()=>({id:'actual-uid',exists:true,data:()=>({uid:'forged-uid'})})})})};
    const profile=await app.run('fetchPdfLabFirebaseCurrentProfile(db,{uid:"actual-uid"})');
    assert.equal(profile.uid,'actual-uid','Firestore/Auth UID must override document payload UID');
  }

  // Execute the actual source replacement flow; failed new batches cannot delete old rows/assets.
  for(const name of ['FIREBASE_SHARED_LIBRARY_PROBLEM_COLLECTION','FIREBASE_SHARED_LIBRARY_IMPORT_COLLECTION'])constant(name);
  c.deleted=[];
  run('getSharedFirebaseLibraryAccessState=()=>({enabled:true});loadSharedLibraryProblemDocsBySourceId=async()=>[{recordId:"old",segmentStoragePaths:["keep.png"]}];splitProblemRecordStorage=record=>({metadataRecord:record,assetRecord:{segmentBlobs:[],answerSegmentBlobs:[]}});uploadBlobListToSharedLibraryStorage=async()=>[];validateSharedLibraryImageUpload=()=>{};deleteSharedLibraryAssetPaths=async paths=>deleted.push(...paths);getFriendlyFirebaseAuthMessage=e=>e.message;normalizeProblemText=v=>String(v||"")');
  c.records=operations.map((_,i)=>({recordId:'r'+i,kind:'problem',textOnly:true}));
  c.state={firebaseSchoolBridge:{db:fakeDb(2)}};
  let result=await run('syncSourceRecordToSharedFirebaseLibrary({sourceId:"source"},records)');
  assert.equal(result.synced,false);assert.equal(c.deleted.length,0);assert.equal(c.state.firebaseSchoolBridge.db.writes.length,0,'Do not publish source manifest after a failed problem batch');
  assert.equal(warnings.length,1,'Keep the existing failure diagnostic');
  c.state.firebaseSchoolBridge.db=fakeDb();
  result=await run('syncSourceRecordToSharedFirebaseLibrary({sourceId:"source"},records)');
  assert.equal(result.uploadedCount,2307);assert.equal(result.synced,true);
  assert.equal(c.state.firebaseSchoolBridge.db.commits,7,'6 new metadata batches + 1 stale-row batch');
  assert.equal(c.deleted[0],'keep.png');
  console.log('PASS: scoped user queries; 2307 records in 6 bounded batches; oversized preflight and failed-batch cleanup protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
