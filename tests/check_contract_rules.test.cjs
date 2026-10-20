// Actual PDF LAB functions against the CODE LAB candidate rules, loopback demo only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('./app_vm.cjs');
assert.equal(process.argv.length,2);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8786');
const project='demo-codelab-reaudit';
const base=`http://127.0.0.1:8786/v1/projects/${project}/databases/(default)/documents`;
const checks=[];
const token=uid=>{
  const now=Math.floor(Date.now()/1000);
  return [{alg:'none',typ:'JWT'},{iss:`https://securetoken.google.com/${project}`,aud:project,sub:uid,user_id:uid,iat:now,exp:now+3600,firebase:{sign_in_provider:'custom'}}]
    .map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.';
};
const headers=uid=>({'Content-Type':'application/json',Authorization:uid==='owner'?'Bearer owner':'Bearer '+token(uid)});
function encode(v) {
  if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
  if(v===null)return {nullValue:null};
  if(typeof v==='object')return {mapValue:{fields:fields(v)}};
  if(typeof v==='boolean')return {booleanValue:v};
  if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  return {stringValue:String(v)};
}
const fields=data=>Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]));
function decode(v) {
  if(v.arrayValue)return (v.arrayValue.values||[]).map(decode);
  if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
  if('integerValue' in v)return Number(v.integerValue);
  if('doubleValue' in v)return v.doubleValue;
  if('booleanValue' in v)return v.booleanValue;
  return v.stringValue??v.timestampValue??null;
}
const snapshot=doc=>({id:doc.name.split('/').pop(),exists:true,metadata:{fromCache:false},data:()=>Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decode(v)]))});
function dbFor(uid) {
  return {collection:collection=>{
    const query=filters=>({where:(...filter)=>query([...filters,filter]),get:async()=>{
      const ops={'==':'EQUAL','array-contains-any':'ARRAY_CONTAINS_ANY','array-contains':'ARRAY_CONTAINS'};
      const clauses=filters.map(([field,op,value])=>({fieldFilter:{field:{fieldPath:field},op:ops[op],value:encode(value)}}));
      const r=await fetch(base+':runQuery',{method:'POST',headers:headers(uid),body:JSON.stringify({structuredQuery:{from:[{collectionId:collection}],...(clauses.length?{where:clauses.length===1?clauses[0]:{compositeFilter:{op:'AND',filters:clauses}}}:{})}})});
      if(!r.ok){await r.text();throw Error('query-denied-'+r.status);}
      return {docs:(await r.json()).filter(row=>row.document).map(row=>snapshot(row.document))};
    },doc:id=>({get:async()=>{
      const r=await fetch(base+'/'+collection+'/'+encodeURIComponent(id),{headers:headers(uid)});
      if(r.status===404){await r.text();return {id,exists:false};}
      if(!r.ok){await r.text();throw Error('read-denied-'+r.status);}
      return snapshot(await r.json());
    },set:async data=>{
      const mask=Object.keys(data).map(key=>'updateMask.fieldPaths='+encodeURIComponent(key)).join('&');
      const r=await fetch(base+'/'+collection+'/'+encodeURIComponent(id)+'?'+mask,{method:'PATCH',headers:headers(uid),body:JSON.stringify({fields:fields(data)})});
      if(!r.ok){await r.text();throw Error('write-denied-'+r.status);}await r.text();
    }})});
    return query([]);
  }};
}
function record(id='contract-personal',classId='a',uid='contract-alice') {
  return {checkSetId:id,classIds:[classId],targetFirebaseUid:uid,assignmentMode:'student',source:'pdf-lab',
    exportPayload:{id,classIds:[classId],targetUserIds:[uid],assignmentMode:'student',source:'pdf-lab',sourceRound:'round1',
      questionMappings:[{questionId:'q1',problemRecordId:'p1'}],questions:[{id:'q1',type:'객관식',answer:'1'}]}};
}
const app=load(undefined,{console:{...console,warn:()=>{}}}),c=app.context;
for(const name of ['DEFAULT_LIBRARY_SOURCE_KEY','EXAM_HISTORY_SCOPE_SCHOOL','PROBLEM_TYPE_OTHER','LIBRARY_SOURCE_OPTIONS','LIBRARY_SOURCE_FILTER_ALL'])app.constant(name);
app.run('isPdfLabFirebaseConfigured=()=>true;ensurePdfLabFirebaseServices=()=>true');
function actor(uid,profile) {c.state={firebaseSchoolBridge:{db:dbFor(uid),currentUser:{uid},currentProfile:profile}};}
async function check(label,fn){await fn();checks.push(label);}
const owner=dbFor('owner');
(async()=>{
  const profiles={
    'contract-admin':{role:'admin',adminScope:'all',classIds:[]},
    'contract-teacher':{role:'admin',adminScope:'classes',classIds:['a']},
    'contract-other':{role:'admin',adminScope:'classes',classIds:['b']},
    'contract-alice':{role:'student',classIds:['a'],uid:'forged-profile-uid'},
    'contract-peer':{role:'student',classIds:['a']},
    'contract-bob':{role:'student',classIds:['b']},
    'contract-unassigned':{role:'student',classIds:[]},
    'contract-disabled':{role:'student',classIds:['a'],loginDisabled:true},
    'contract-disabled-admin':{role:'admin',adminScope:'all',classIds:[],loginDisabled:true}
  };
  for(const [uid,p] of Object.entries(profiles))await owner.collection('users').doc(uid).set(p);
  for(const [actorId,setId] of [['contract-admin','contract-personal'],['contract-teacher','contract-teacher-set']]){
    await check(actorId+' personal upload',async()=>{
      actor(actorId,profiles[actorId]);c.records=[record(setId)];
      assert.equal((await app.run('uploadExamCheckSetRecordsToCodeLab(records)')).uploaded,1);
      const saved=(await owner.collection('portalCheckSets').doc(setId).get()).data();
      assert.equal(saved.accessSchemaVersion,1);assert.equal(saved.assignmentMode,'personal');
      assert.deepEqual(saved.targetUserIds,['contract-alice']);assert.deepEqual(saved.payload.targetUserIds,['contract-alice']);
    });
  }
  const personal=db=>db.collection('portalCheckSets').doc('contract-personal').get();
  for(const uid of ['contract-alice','contract-teacher','contract-admin'])await check(uid+' assigned read',async()=>assert.equal((await personal(dbFor(uid))).exists,true));
  for(const uid of ['contract-peer','contract-bob','contract-other','contract-unassigned','contract-disabled'])await check(uid+' nonassigned read denied',async()=>assert.rejects(personal(dbFor(uid)),/denied-403/));
  await check('class upload and same-class student read',async()=>{
    actor('contract-teacher',profiles['contract-teacher']);c.records=[{...record('contract-class'),targetFirebaseUid:'',assignmentMode:'class',exportPayload:{questions:[],classIds:['a'],assignmentMode:'class'}}];
    await app.run('uploadExamCheckSetRecordsToCodeLab(records)');
    assert.equal((await dbFor('contract-peer').collection('portalCheckSets').doc('contract-class').get()).exists,true);
  });
  await check('cross-class upload rejected',async()=>{
    actor('contract-teacher',profiles['contract-teacher']);c.records=[record('contract-foreign','b','contract-bob')];
    await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'));
    assert.equal((await owner.collection('portalCheckSets').doc('contract-foreign').get()).exists,false);
  });
  await check('disabled admin upload rejected',async()=>{
    actor('contract-disabled-admin',profiles['contract-disabled-admin']);c.records=[record('contract-disabled-write')];
    await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'));
    assert.equal((await owner.collection('portalCheckSets').doc('contract-disabled-write').get()).exists,false);
  });
  await check('legacy cannot be promoted by limited instructor',async()=>{
    const old={classIds:['a'],assignmentMode:'student',targetUserIds:['contract-alice'],payload:{questions:[]}};
    await owner.collection('portalCheckSets').doc('contract-legacy').set(old);
    actor('contract-teacher',profiles['contract-teacher']);c.records=[record('contract-legacy')];
    await assert.rejects(app.run('uploadExamCheckSetRecordsToCodeLab(records)'),/denied-403/);
    assert.equal((await owner.collection('portalCheckSets').doc('contract-legacy').get()).data().accessSchemaVersion,undefined);
  });
  await check('scoped list and authoritative document ID',async()=>{
    const doc=(await owner.collection('portalCheckSets').doc('contract-personal').get()).data();
    await owner.collection('portalCheckSets').doc('contract-forged-id').set({...doc,docId:'forged',payload:{...doc.payload,id:'forged'}});
    await owner.collection('portalCheckSets').doc('contract-other-class').set({...doc,classIds:['b'],targetUserIds:['contract-bob']});
    actor('contract-teacher',profiles['contract-teacher']);
    c.student={firebaseUid:'contract-alice'};c.imported=[];
    app.run('getSelectedRetryStudent=()=>student;getStudentRetrySessionSyncContextKey=()=>"test";getStudentRetrySchoolKey=()=>"test";getStudentRetrySourceKey=()=>"test";getSelectedSchoolProfile=()=>({name:"Synthetic"});doesCheckSetRecordMatchRetrySchool=()=>true;doesRetrySourceFilterMatch=()=>true;upsertCheckSetRecordsFromFirebase=async records=>{imported=records;return records.length};ensureStudentRetrySessionsFromAvailableCheckSets=()=>({created:0});ensureStudentRetrySelection=()=>{};renderStudentRetryPanel=()=>{}');
    const result=await app.run('syncStudentRetrySessionsFromFirebaseCheckSets({force:true})');
    assert.equal(result.synced,true);
    const ids=Array.from(c.imported,r=>r.checkSetId);
    assert.ok(ids.includes('contract-personal'));assert.ok(ids.includes('contract-forged-id'));
    assert.ok(!ids.includes('forged')&&!ids.includes('contract-legacy')&&!ids.includes('contract-other-class'));
  });
  const response={userId:'contract-alice',role:'student',classIds:['a'],checkSetId:'contract-personal',submittedAt:'2026-10-20',id:'forged',answers:[{questionId:'q1',isCorrect:false}]};
  await owner.collection('checkResponses').doc('contract-response').set(response);
  await owner.collection('checkResponses').doc('contract-other-response').set({...response,classIds:['b'],userId:'contract-bob'});
  await check('scoped response lookup',async()=>{
    actor('contract-teacher',profiles['contract-teacher']);c.record=record();c.student={firebaseUid:'contract-alice'};
    const result=await app.run('fetchLatestCheckResponseForRetryRoundRecord(record,student)');
    assert.equal(result.id,'contract-response');assert.equal(result.userId,'contract-alice');
  });
  await check('unscoped list and response query remain denied',async()=>{
    await assert.rejects(dbFor('contract-teacher').collection('portalCheckSets').get(),/denied-403/);
    await assert.rejects(dbFor('contract-teacher').collection('checkResponses').where('checkSetId','==','contract-personal').get(),/denied-403/);
  });
  await check('full admin retains legacy read',async()=>{
    const docs=await c.PDFLabFirebase.loadClassScopedDocs(dbFor('contract-admin'),'portalCheckSets',profiles['contract-admin'],[]);
    assert.ok(docs.some(d=>d.id==='contract-legacy'));
  });
  // Use CODE LAB's real query planner and material normalizer with the same emulator data.
  const codeSource=fs.readFileSync(path.resolve(__dirname,'../../CODE LAB/rotation_portal_enhancements.js'),'utf8');
  const portal=vm.createContext({console,clonePlainData:value=>JSON.parse(JSON.stringify(value)),
    PORTAL_CLOUD_SET_COLLECTIONS:{check:'portalCheckSets',prep:'portalPrepSets'},
    withPortalReadTimeout:promise=>promise,readPortalFirestoreRest:async()=>{throw Error('material-query-denied');}});
  for(const name of ['getPortalSetCollection','derivePortalSetClassIds','normalizePortalSetDoc','sortPortalSetDocs','loadCloudSetDocs']){
    const match=codeSource.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}', 'm'));
    assert.ok(match,'CODE LAB source function required: '+name);vm.runInContext(match[0],portal);
  }
  vm.runInContext('function isPortalAdmin(){return portalState.currentProfile.role==="admin";}function isPortalSuperAdmin(){return isPortalAdmin()&&portalState.currentProfile.adminScope==="all";}function isGrammarOnlyStudent(){return !isPortalAdmin()&&portalState.currentProfile.classIds.includes("class-grammar-only");}',portal);
  for(const uid of ['contract-alice','contract-teacher','contract-admin'])await check('CODE LAB actual material load '+uid,async()=>{
    portal.portalState={firebaseEnabled:true,db:dbFor(uid),currentUser:{uid},currentProfile:profiles[uid],userSession:{}};
    const docs=await vm.runInContext('loadCloudSetDocs("check")',portal);
    assert.ok(docs.some(d=>d.docId==='contract-personal'&&d.assignmentMode==='personal'&&d.payload.id==='contract-personal'));
    if(uid!=='contract-admin')assert.ok(!docs.some(d=>d.docId==='contract-legacy'||d.docId==='contract-other-class'));
  });
  await check('CODE LAB peer sees class assignment without private peer documents',async()=>{
    const uid='contract-peer';portal.portalState={firebaseEnabled:true,db:dbFor(uid),currentUser:{uid},currentProfile:profiles[uid],userSession:{}};
    const docs=await vm.runInContext('loadCloudSetDocs("check")',portal);
    assert.ok(docs.some(d=>d.docId==='contract-class'));assert.ok(!docs.some(d=>d.docId==='contract-personal'));
  });
  for(const uid of ['contract-unassigned','contract-disabled'])await check('CODE LAB actual load denied '+uid,async()=>{
    portal.portalState={firebaseEnabled:true,db:dbFor(uid),currentUser:{uid},currentProfile:profiles[uid],userSession:{}};
    await assert.rejects(vm.runInContext('loadCloudSetDocs("check")',portal));
  });
  console.log(JSON.stringify({checkContractRulesPassed:checks.length,productionAccess:false}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
