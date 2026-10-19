const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');
const { context: c, run, constant } = load();
for (const name of ['DEFAULT_LIBRARY_SOURCE_KEY', 'STUDENT_RETRY_STORAGE_KEY',
  'FIREBASE_STUDENT_RETRY_PREF_COLLECTION','FIREBASE_STUDENT_RETRY_STUDENT_COLLECTION',
  'FIREBASE_STUDENT_RETRY_SESSION_COLLECTION','FIREBASE_STUDENT_RETRY_STATE_COLLECTION']) constant(name);
const student = { studentId:'a',name:'Kim',schoolKey:'class',updatedAt:1,createdAt:1 };
c.local = { deletedStudents:{a:2},students:[],sessions:[] };
c.remote = { students:[student],sessions:[] };
assert.equal(run('mergeStudentRetryStates(local,remote).students.length'), 0, 'Deletion must survive stale merge');
(async () => {
  const docs = new Map(); let writes = 0;
  const db = { collection: name => ({ doc: id => ({ key: name+'/'+id, set: async data => { docs.set(name+'/'+id,data); writes++; } }) }),
    runTransaction: async callback => callback({
      get: async ref => ({ exists: docs.has(ref.key), data: () => docs.get(ref.key) }),
      set: (ref,data) => { docs.set(ref.key,data); writes++; }
    }) };
  c.state={ studentRetryOwnerUid:'admin',studentRetry:c.remote,firebaseSchoolBridge:{db,currentUser:{uid:'admin'},currentProfile:{role:'admin'}} };
  c.rows=[{docId:'a',data:student}];c.db=db;
  docs.set('students/b',{studentId:'b'});
  await run('saveFirebaseOwnerCollection("students",rows)');
  assert.ok(docs.has('students/b'), 'Unrelated remote document must remain');
  const firstWrites=writes;
  await run('saveFirebaseOwnerCollection("students",rows)');
  assert.equal(writes,firstWrites,'Unchanged rows must not be written again');
  docs.set('students/a',{studentId:'a',deletedAt:9});
  c.state.firebaseSchoolBridge.retryStateSavedRows={};
  await run('saveFirebaseOwnerCollection("students",rows)');
  assert.equal(docs.get('students/a').deletedAt,9,'Stale writer must not resurrect tombstone');
  let release; let calls=0; const names=[];
  c.hold=()=>new Promise(resolve=>{release=resolve;});
  c.record=snapshot=>{names.push(snapshot[0]?.data.name);calls++;return calls===1?c.hold():Promise.resolve();};
  run('loadStudentRetryStateFromFirebase=async()=>({loaded:true,hasRemote:false}); saveFirebaseOwnerCollection=async(name,rows)=>name===FIREBASE_STUDENT_RETRY_STUDENT_COLLECTION?record(rows):undefined');
  const first=run('saveStudentRetryStateToFirebase()');
  await new Promise(resolve=>setImmediate(resolve));
  c.state.studentRetry.students[0].name='Updated';
  const second=run('saveStudentRetryStateToFirebase()');release();
  await Promise.all([first,second]);
  assert.equal(names.at(-1),'Updated');assert.equal(calls,2,'Dirty state needs one trailing save');
  assert.ok(writes>0);
  console.log('PASS: deletion merge, non-destructive upserts, stale tombstone protection, trailing save');
})().catch(error=>{console.error(error);process.exitCode=1;});
