const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const load = require('./app_vm.cjs');
module.exports = async function () {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8785');
  assert.ok(process.env.PDFLAB_FIREBASE_TEST_SDK,'Set PDFLAB_FIREBASE_TEST_SDK to the isolated firebase@10.12.2 test installation (security/README.md)');
  const root=path.resolve(__dirname,'..');
  const codeLabSource=process.env.PDFLAB_CODE_LAB_SOURCE || path.resolve(root,'../CODE LAB/rotation_portal_enhancements.js');
  const expected=JSON.parse(fs.readFileSync(path.join(root,'security/code-lab-compat-base.json'),'utf8'));
  const sandbox=path.join(root,'tmp/security-hardening-20261020/code-lab-compat');
  fs.mkdirSync(sandbox,{recursive:true});
  const sourceStates=[];
  for(const file of expected.files){
    // Compare Git's LF content; Windows checkouts may use CRLF without changing the source.
    const original=Buffer.from(fs.readFileSync(path.join(path.dirname(codeLabSource),file.file),'utf8').replace(/\r\n/g,'\n'));
    const hash=crypto.createHash('sha256').update(original).digest('hex');
    assert.ok(hash===file.sha256 || hash===file.patchedSha256,'CODE LAB changed: review and refresh the compatibility patch before testing');
    sourceStates.push(hash===file.sha256?'original':'patched');
    fs.writeFileSync(path.join(sandbox,file.file),original);
  }
  assert.equal(new Set(sourceStates).size,1,'CODE LAB compatibility patch is only partially applied');
  const patchArgs=['--directory=tmp/security-hardening-20261020/code-lab-compat','security/code-lab-compat.patch'];
  if(sourceStates[0]==='original'){
    execFileSync('git',['apply','--check',...patchArgs],{cwd:root});
    execFileSync('git',['apply',...patchArgs],{cwd:root});
  }
  assert.ok(fs.readFileSync(path.join(sandbox,'index.html'),'utf8').includes('rotation_portal_enhancements.js?v=20261020-firebase-scope-01'));
  const sdkRoot = process.env.PDFLAB_FIREBASE_TEST_SDK;
  const resolve = name => require.resolve(name,{paths:[sdkRoot]});
  const firebase = require(resolve('firebase/compat/app'));
  require(resolve('firebase/compat/firestore'));
  assert.equal(firebase.SDK_VERSION,'10.12.2');
  const apps=[];
  const connect = uid => {
    const app=firebase.initializeApp({projectId:'demo-pdflab-audit',apiKey:'emulator-only'},'test-'+uid);
    apps.push(app);const db=app.firestore();db.useEmulator('127.0.0.1',8785,{mockUserToken:{sub:uid,user_id:uid}});return db;
  };
  const teacher=connect('teacher'),other=connect('otherTeacher'),admin=connect('admin');
  // VM objects have a different Object prototype. Serialize at this test-only wire boundary.
  const plain=data=>structuredClone(data);
  function wireDb(db){
    return {collection:name=>{
      const collection=db.collection(name),doc=collection.doc.bind(collection),where=collection.where.bind(collection);
      collection.doc=id=>{const ref=doc(id),set=ref.set.bind(ref);ref.set=(data,...args)=>set(plain(data),...args);return ref;};
      collection.where=(field,operator,value)=>where(field,operator,plain(value));
      return collection;
    },runTransaction:callback=>db.runTransaction(tx=>callback({get:ref=>tx.get(ref),set:(ref,data,...args)=>tx.set(ref,plain(data),...args)})),
    batch:()=>{const batch=db.batch();return {set:(ref,data,...args)=>batch.set(ref,plain(data),...args),delete:ref=>batch.delete(ref),commit:()=>batch.commit()};}};
  }
  try {
    for (const suffix of ['Prefs','Students','Sessions','StudentStates','ExamSets','ExamItems','Works']) {
      const snapshot=await teacher.collection('pdfLabStudentRetry'+suffix).where('ownerUid','==','teacher').get();
      for(const doc of snapshot.docs) await doc.ref.delete();
    }
    const app=load();
    app.constant('EXAM_HISTORY_SCOPE_STUDENT_RETRY');app.constant('EXAM_HISTORY_SCOPE_SCHOOL');
    for(const name of ['DEFAULT_LIBRARY_SOURCE_KEY','LIBRARY_SOURCE_FILTER_ALL','STUDENT_RETRY_STORAGE_KEY','FIREBASE_STUDENT_RETRY_PREF_COLLECTION','FIREBASE_STUDENT_RETRY_STUDENT_COLLECTION','FIREBASE_STUDENT_RETRY_SESSION_COLLECTION','FIREBASE_STUDENT_RETRY_STATE_COLLECTION','FIREBASE_STUDENT_RETRY_EXAM_COLLECTION','FIREBASE_STUDENT_RETRY_EXAM_ITEM_COLLECTION','FIREBASE_STUDENT_RETRY_WORK_COLLECTION'])app.constant(name);
    app.context.state={studentRetryOwnerUid:'teacher',studentRetry:{students:Array.from({length:201},(_,i)=>({studentId:'sdk-'+i,name:'합성 학생 '+i,schoolKey:'a',createdAt:1,updatedAt:1})),sessions:[]},firebaseSchoolBridge:{db:wireDb(teacher),currentUser:{uid:'teacher'},currentProfile:{role:'admin',adminScope:'assigned',classIds:['a']}}};
    app.run('setStatus=(...args)=>{throw Error(args.join(" "))}');
    let result=await app.run('saveStudentRetryStateToFirebase({mergeRemote:false})');
    assert.equal(result.synced,true,result.reason);
    const saved=await app.run('loadStudentRetryStateFromFirebase()');
    assert.equal(saved.state.students.length,201,'Actual app save/query/load must round-trip 201 students');
    app.context.state.studentRetry.students[0].name='수정 학생';app.context.state.studentRetry.students[0].updatedAt=2;
    result=await app.run('saveStudentRetryStateToFirebase({mergeRemote:false})');assert.equal(result.synced,true,result.reason);
    app.context.state.studentRetry.students.shift();app.context.state.studentRetry.deletedStudents={'sdk-0':3};
    result=await app.run('saveStudentRetryStateToFirebase({mergeRemote:false})');assert.equal(result.synced,true,result.reason);
    const afterDelete=await app.run('loadStudentRetryStateFromFirebase()');
    assert.equal(afterDelete.state.students.length,200);assert.equal(afterDelete.state.deletedStudents['sdk-0'],3);
    app.context.rows=[{docId:app.run('createFirebaseRetryDocId("teacher","student","sdk-0")'),data:{studentId:'sdk-0',name:'stale',updatedAt:1}}];
    app.context.state.firebaseSchoolBridge.retryStateSavedRows={};
    await app.run('saveFirebaseOwnerCollection(FIREBASE_STUDENT_RETRY_STUDENT_COLLECTION,rows)');
    assert.equal((await app.run('loadStudentRetryStateFromFirebase()')).state.students.length,200,'Stale device must not resurrect a deletion');
    await assert.rejects(other.collection('pdfLabStudentRetryStudents').where('ownerUid','==','teacher').get(),e=>e.code==='permission-denied');
    app.context.exam={examId:'sdk-exam',historyScope:'student-retry',title:'합성 출제 이력'};app.context.items=[{entryId:'sdk-item',examId:'sdk-exam',slotIndex:1}];
    assert.equal((await app.run('saveStudentRetryExamHistoryToFirebase(exam,items)')).synced,true);
    assert.equal((await app.run('saveStudentRetryWorkToFirebase({workId:"sdk-work",kind:"exam",payload:{studentRetry:{studentId:"sdk-1"}},title:"합성 작업"})')).synced,true);
    assert.equal((await teacher.collection('pdfLabStudentRetryExamItems').where('ownerUid','==','teacher').get()).size,1);
    await app.run('deleteStudentRetryExamHistoryFromFirebase("sdk-exam")');
    assert.equal((await teacher.collection('pdfLabStudentRetryExamItems').where('ownerUid','==','teacher').get()).size,0);

    // The external CODE LAB source stays untouched. Execute the reviewed patch on an isolated copy.
    const patched=fs.readFileSync(path.join(sandbox,'rotation_portal_enhancements.js'),'utf8');
    const functions=new Map([...patched.matchAll(/^(?:async )?function (\w+)\([^]*?^}\r?$/gm)].map(m=>[m[1],m[0]]));
    const ctx=vm.createContext({console,Date,Map,Set});
    for(const name of ['createPortalStudentProfileByAdmin','fetchOrCreateUserProfile','fetchScopedPortalUserDocs','fetchAdminStudentProfiles','fetchAllPortalUsersForSuperAdmin']){assert.ok(functions.has(name),name);vm.runInContext(functions.get(name),ctx);}
    ctx.portalState={firebaseEnabled:true,db:wireDb(admin),currentProfile:{role:'admin',adminScope:'all'}};
    ctx.window={firebase:true,ROTATION_FIREBASE_CONFIG:{}};
    ctx.SUPERADMIN_DEFAULT_PASSWORD='emulator-test-only';
    ctx.firebase={initializeApp:()=>({auth:()=>({createUserWithEmailAndPassword:async()=>({user:{uid:'sdk-new-student',updateProfile:async()=>{}}}),signOut:async()=>{}}),delete:async()=>{}})};
    ctx.record={role:'student',classIds:['a'],name:'합성 신규 학생',adminScope:'assigned'};
    await vm.runInContext('createPortalStudentProfileByAdmin(record)',ctx);
    assert.deepEqual((await admin.collection('users').doc('sdk-new-student').get()).data().classIds,['a'],'Provision assigned student through the administrator connection');
    ctx.normalizeUserProfile=v=>v;ctx.derivePortalLoginId=()=> 'new';ctx.prepClasses=[{id:'must-not-auto-enroll'}];
    const newcomer=connect('sdk-first-login');
    ctx.getFirebaseUserProfileSnapshot=uid=>newcomer.collection('users').doc(uid).get();
    ctx.saveFirebaseUserProfile=(uid,data)=>newcomer.collection('users').doc(uid).set(plain(data));
    const newProfile=await vm.runInContext('fetchOrCreateUserProfile({uid:"sdk-first-login",email:"synthetic@example.invalid"})',ctx);
    assert.equal(newProfile.classIds.length,0,'New login must await administrator class assignment');
    ctx.normalizeAdminScopeValue=value=>value==='all'?'all':'assigned';
    ctx.portalState={firebaseEnabled:true,db:wireDb(teacher),currentProfile:{role:'admin',adminScope:'assigned',classIds:['a']}};
    const scoped=await vm.runInContext('fetchScopedPortalUserDocs()',ctx);
    assert.ok(scoped.length>0);assert.ok(scoped.every(doc=>doc.data().classIds.includes('a')));
    console.log('PASS: real Firebase 10.12.2 SDK + actual app save/load/201-student transactions/tombstones/history/work; patched CODE LAB provisioning/first login/scoped query');
  } finally { await Promise.all(apps.map(app=>app.delete())); }
};
