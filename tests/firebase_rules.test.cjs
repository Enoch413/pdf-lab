// Emulator only: no credentials, SDK, production data, or production endpoint.
const assert = require('node:assert/strict');
const project = 'demo-pdflab-audit';
for (const [name, expected] of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8785', FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9299'})) {
  assert.equal(process.env[name], expected, `Run via security/firebase.emulators.json (${name})`);
}
const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
const token = uid => {
  const now = Math.floor(Date.now()/1000);
  return [ {alg:'none',typ:'JWT'}, {iss:`https://securetoken.google.com/${project}`,aud:project,sub:uid,user_id:uid,iat:now,exp:now+3600,firebase:{sign_in_provider:'custom'}} ]
    .map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.';
};
const encode = value => Array.isArray(value) ? {arrayValue:{values:value.map(encode)}} : typeof value === 'boolean' ? {booleanValue:value} : {stringValue:String(value)};
const fields = data => Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]));
async function doc(path, uid, data) {
  return fetch(`${base}/${path}`, {method:data ? 'PATCH':'GET',headers:{'Content-Type':'application/json',...(uid?{Authorization:uid==='owner'?'Bearer owner':'Bearer '+token(uid)}:{})},...(data?{body:JSON.stringify({fields:fields(data)})}:{})});
}
async function query(uid, collectionId, where) {
  return fetch(base+':runQuery',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(uid)},body:JSON.stringify({structuredQuery:{from:[{collectionId}],...(where?{where}:{})}})});
}
async function upload(uid, name) {
  return fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${project}.appspot.com/o?uploadType=media&name=${encodeURIComponent(name)}`,{method:'POST',headers:{'Content-Type':'image/png',...(uid?{Authorization:'Bearer '+token(uid)}:{})},body:Buffer.from('local-rule-test')});
}
(async()=>{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  const users={admin:{role:'admin',adminScope:'all',classIds:[]},teacher:{role:'admin',adminScope:'classes',classIds:['a']},otherTeacher:{role:'admin',adminScope:'classes',classIds:['b']},alice:{role:'student',classIds:['a']},bob:{role:'student',classIds:['b']}};
  for(const [uid,data] of Object.entries(users)) assert.equal((await doc('users/'+uid,'owner',data)).status,200);
  let checks=0;const failures=[];
  async function check(label,response,allowed){
    const status=response.status; const ok=allowed?status===200:[401,403].includes(status);
    checks++;if(!ok)failures.push(`${label}: ${status}, expected ${allowed?'allow':'deny'}`);
    await response.text();
  }
  await check('anonymous users denied',await doc('users/alice',null),false);
  await check('own profile allowed',await doc('users/alice','alice'),true);
  await check('assigned class profile allowed',await doc('users/alice','teacher'),true);
  await check('other class profile denied',await doc('users/bob','teacher'),false);
  await check('unscoped users query denied',await query('teacher','users'),false);
  await check('scoped users query allowed',await query('teacher','users',{fieldFilter:{field:{fieldPath:'classIds'},op:'ARRAY_CONTAINS_ANY',value:encode(['a'])}}),true);
  await check('full admin users query allowed',await query('admin','users'),true);
  await check('self admin creation denied',await doc('users/intruder','intruder',{role:'admin',adminScope:'all',classIds:[]}),false);
  await check('safe student creation allowed',await doc('users/newStudent','newStudent',{role:'student',classIds:[]}),true);
  await check('forged profile uid denied',await doc('users/forgedUid','forgedUid',{uid:'alice',role:'student',classIds:[]}),false);
  await check('self assigned class denied',await doc('users/forgedClass','forgedClass',{role:'student',classIds:['b']}),false);
  await check('limited teacher self promotion denied',await doc('users/teacher','teacher',{...users.teacher,adminScope:'all'}),false);
  await check('self role promotion denied',await doc('users/alice','alice',{...users.alice,role:'admin',passwordResetRequired:false,updatedAt:'today'}),false);
  await check('added privilege field denied',await doc('users/alice','alice',{...users.alice,grammarAccessMode:'all',passwordResetRequired:false,updatedAt:'today'}),false);
  await check('password reset flag allowed',await doc('users/alice','alice',{...users.alice,passwordResetRequired:false,updatedAt:'today'}),true);
  for(const suffix of ['Prefs','Students','Sessions','StudentStates','ExamSets','ExamItems','Works']){
    const collection='pdfLabStudentRetry'+suffix;
    await doc(collection+'/mine','owner',{ownerUid:'teacher'});
    await check(suffix+' own read',await doc(collection+'/mine','teacher'),true);
    await check(suffix+' other owner read denied',await doc(collection+'/mine','otherTeacher'),false);
    await check(suffix+' owner forgery denied',await doc(collection+'/forged','teacher',{ownerUid:'otherTeacher'}),false);
    await check(suffix+' owner change denied',await doc(collection+'/mine','teacher',{ownerUid:'otherTeacher'}),false);
    // Missing documents carry no data; transactions must be able to read them before creating.
    const ownId=suffix==='Prefs'?'teacher':'teacher__new';
    assert.equal((await doc(collection+'/'+ownId,'teacher')).status,404);
    await check(suffix+' own create allowed',await doc(collection+'/'+ownId,'teacher',{ownerUid:'teacher'}),true);
    const victimId=suffix==='Prefs'?'otherTeacher':'otherteacher__new';
    await check(suffix+' foreign document ID preclaim denied',await doc(collection+'/'+victimId,'teacher',{ownerUid:'teacher'}),false);
  }
  await check('student library read denied',await query('alice','pdfLabSharedLibraryProblems'),false);
  await check('admin library write allowed',await doc('pdfLabSharedLibraryProblems/shared','teacher',{sourceId:'test'}),true);
  await doc('questionIssues/bobs-issue','owner',{userId:'bob'});
  await check('issue ownership takeover denied',await doc('questionIssues/bobs-issue','alice',{userId:'alice'}),false);
  await check('anonymous storage write denied',await upload(null,'pdf-lab/shared-library/test/anonymous.png'),false);
  await check('student storage write denied',await upload('alice','pdf-lab/shared-library/test/student.png'),false);
  await check('admin storage write allowed',await upload('teacher','pdf-lab/shared-library/test/admin.png'),true);
  await check('student unrelated storage path denied',await upload('alice','unrelated/student.png'),false);
  for(const [uid,allowed] of [[null,false],['alice',false],['teacher',true]]) {
    await check('storage read '+(uid||'anonymous'),await fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${project}.appspot.com/o/pdf-lab%2Fshared-library%2Ftest%2Fadmin.png?alt=media`,{headers:uid?{Authorization:'Bearer '+token(uid)}:{}}),allowed);
  }
  if(failures.length) throw new Error(failures.join('\n'));
  console.log(`PASS: ${checks} Firestore/Storage authorization checks on local emulators`);
  await require('./firebase_app_integration.cjs')();
})().catch(e=>{console.error(e.stack || e.message);process.exitCode=1;});
