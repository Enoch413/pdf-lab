// R1/R2/R3 regression; a fresh browser context and SDK memory mock only.
// --before serves the previous ZIP sources and expects its known failures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.PDFLAB_NODE_MODULES||'../node_modules','playwright'));
const root=path.resolve(__dirname,'..'),before=process.argv.includes('--before');
const baseline=path.join(root,'output/hanbujang-compat-review-20260928');
const out=path.join(root,'tmp/hanbujang-fix-verification');
const input=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json'),'utf8'));
const p05=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang/P05_CANONICAL_ACTUAL.json'),'utf8'));
const origin='http://pdflab-fix-test.local';
const result={mode:before?'BEFORE_EXPECTED_FAILURES':'AFTER_REGRESSION',status:'RUNNING',cases:[]};
const pass=(name,details)=>{result.cases.push({name,result:before?'BEFORE_OBSERVED':'PASS',...details});console.log((before?'BEFORE_OBSERVED ':'PASS ')+name);};
async function mockFirebase(page){
  await page.evaluate(()=>{
    window.qaRemote=new Map();
    const doc=(name,id)=>({name,id,set:async(value,options)=>qaRemote.set(name+'/'+id,{...(options?.merge?qaRemote.get(name+'/'+id)||{}:{}),...structuredClone(value)}),
      get:async()=>({id,exists:qaRemote.has(name+'/'+id),data:()=>structuredClone(qaRemote.get(name+'/'+id))}),delete:async()=>qaRemote.delete(name+'/'+id)});
    const documents=(name,field,value)=>[...qaRemote].filter(([k,v])=>k.startsWith(name+'/')&&(!field||v[field]===value)).map(([k,v])=>({id:k.slice(name.length+1),data:()=>structuredClone(v),ref:doc(name,k.slice(name.length+1))}));
    const collection=name=>({doc:id=>doc(name,id),get:async()=>({docs:documents(name)}),where:(field,op,value)=>({get:async()=>({docs:documents(name,field,value)})})});
    state.firebaseSchoolBridge.db={collection,batch:()=>{const pending=[];return{set:(ref,value,options)=>pending.push({ref,value,options}),commit:async()=>{for(const p of pending)await p.ref.set(p.value,p.options);}};}};
    state.firebaseSchoolBridge.storage={ref:()=>{throw Error('Unexpected Storage operation');}};
    getSharedFirebaseLibraryAccessState=()=>({enabled:true});
    ensureExplicitLibrarySaveTargetsReady=async()=>{};
    syncSelectedLibraryDestinations=async(source,records,options)=>({mode:'firebase',firebase:options.skipFirebase?{attempted:false}:{attempted:true,...await syncSourceRecordToSharedFirebaseLibrary(source,records)},folder:{attempted:false,synced:false}});
  });
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const context=await browser.newContext();let previewHtml='';
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
      if(url.pathname==='/qa-preview.html')return route.fulfill({body:previewHtml,contentType:'text/html; charset=utf-8'});
      if(/firebase.*config/i.test(url.pathname))return route.fulfill({body:'/* offline mock */',contentType:'text/javascript'});
      const relative='.'+decodeURIComponent(url.pathname),live=path.resolve(root,relative);
      if(!live.startsWith(root+path.sep)||!['app','dist'].some(p=>live.startsWith(path.join(root,p)+path.sep)))return route.abort();
      const previous=path.resolve(baseline,relative),target=before&&fs.existsSync(previous)?previous:live;
      if(!fs.existsSync(target)||!fs.statSync(target).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(target),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(target)]||'application/octet-stream'});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const goto=async(name='index')=>{await page.goto(origin+'/app/'+name+'.html?workspace=library');await page.waitForFunction(()=>document.body.dataset.appReady==='true');};
    await goto();
    // Source is optional now; explicitly choose A for this source-move regression.
    await page.getByText('기존 PDF / 출처 참고정보 (선택)', {exact:true}).click();
    await page.locator('#librarySourceSelect').selectOption('neoreunteo');
    await page.locator('#newTextbookInput').fill('R2 격리 교재');
    await page.locator('#problemJsonInput').setInputFiles({name:'source-change.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
    await page.waitForFunction(()=>!state.isBusy&&state.problems.length===7);
    await mockFirebase(page);
    await page.evaluate(()=>saveProblemsToLibrary());
    const sourceA=await page.evaluate(()=>state.problems.find(PDFLabCanonical.has).canonicalDocumentId);
    // The real select event (not direct state assignment) changes the destination.
    await page.locator('#librarySourceSelect').selectOption('thelab4you');
    assert.equal(await page.evaluate(()=>state.selectedLibrarySourceKey),'thelab4you');
    // Save work *before* B library save: snapshots must already use B's destination.
    await page.evaluate(async()=>{await saveCurrentRepackWork();window.qaWorkId=state.loadedRepackWorkId;});
    const workId=await page.evaluate(()=>qaWorkId);
    await page.evaluate(()=>saveProblemsToLibrary());
    await page.evaluate(()=>saveProblemsToLibrary());
    await page.reload();await page.waitForFunction(()=>document.body.dataset.appReady==='true');
    const saved=await page.evaluate(()=>state.libraryCache.problemRecords);
    assert.equal(saved.length,14);assert.equal(new Set(saved.map(r=>r.recordId)).size,14);
    const sources=[...new Set(saved.map(r=>r.sourceId))];assert.equal(sources.length,2);
    const sourceB=sources.find(s=>s!==sourceA);assert(sourceB);
    const groups=await page.evaluate(()=>{
      return ['neoreunteo','thelab4you'].map(source=>{
        const first=state.libraryCache.problemRecords.find(r=>r.librarySourceKey===source&&r.canonical.questionGroupId);
        const pack=getTailPackRecordsByKey(createTailPackKey(first));
        return {source,key:createTailPackKey(first),count:pack.length,orders:pack.map(r=>r.canonical.groupOrder),sizes:pack.map(r=>r.canonical.groupSize)};
      });
    });
    for(const g of groups){assert.equal(g.count,before?4:2);assert.deepEqual(g.orders,before?[1,1,2,2]:[1,2]);assert(g.sizes.every(s=>s===2));}
    if(!before){assert.notEqual(groups[0].key,groups[1].key);saved.forEach(r=>assert.equal(r.canonicalDocumentId,r.sourceId));}
    for(const source of sources){
      const records=saved.filter(r=>r.sourceId===source).sort((a,b)=>a.number-b.number);
      assert.deepEqual(records.map(r=>r.canonical),input.problems);
      records.forEach(r=>assert.deepEqual(r.canonicalSource,{sourceName:input.sourceName,textbookName:input.textbookName,uploadFileName:'source-change.json'}));
    }
    pass('R2 actual upload → A save → select change → B save twice → IndexedDB reload',{groups,storedRecords:saved.length,duplicates:0});
    await page.evaluate(async id=>loadSavedWork(id),workId);
    const restored=await page.evaluate(()=>({source:state.selectedLibrarySourceKey,problems:state.problems}));
    assert.equal(restored.source,'thelab4you');assert.deepEqual(restored.problems.map(r=>r.canonical),input.problems);
    if(!before)assert(restored.problems.every(r=>r.canonicalDocumentId===sourceB));
    pass('R2 saved work before B save restores B scope and original canonical',{canonicalDocumentIds:[...new Set(restored.problems.map(r=>r.canonicalDocumentId))]});
    await mockFirebase(page);
    await page.evaluate(records=>{for(const r of records)qaRemote.set(FIREBASE_SHARED_LIBRARY_PROBLEM_COLLECTION+'/'+r.recordId,r);},saved);
    const target=saved.find(r=>r.sourceId===sourceA&&r.canonical.questionGroupId);
    await page.evaluate(id=>openLibraryTextEditor('stored',id),target.recordId);
    await page.locator('[data-canonical-edit="bodyText"]').fill('A only common body.\n  Spaces retained.');
    const editError=await page.evaluate(async()=>{try{await saveLibraryTextEditorChanges();return '';}catch(e){return e.message;}});
    if(before)assert.match(editError,/groupSize/);
    else{
      assert.equal(editError,'');
      const edited=await page.evaluate(()=>({local:state.libraryCache.problemRecords,remote:[...qaRemote.values()].filter(r=>r.canonical)}));
      for(const list of [edited.local,edited.remote]){
        const a=list.filter(r=>r.sourceId===sourceA&&r.canonical.questionGroupId);assert.equal(a.length,2);assert(a.every(r=>r.canonical.bodyText==='A only common body.\n  Spaces retained.'));
        assert.deepEqual(list.filter(r=>r.sourceId===sourceB).sort((a,b)=>a.number-b.number).map(r=>r.canonical),input.problems);
      }
    }
    pass('R2 actual stored group editor; A changes never affect B',{editError});
    for(const name of ['index','final_test','general_exam']){
      await goto(name);
      const actual=await page.evaluate(async({saved,input,sourceA,sourceB})=>{
        const C=PDFLabCanonical;state.libraryCache.problemRecords=saved;
        const a=saved.find(r=>r.sourceId===sourceA&&r.canonical.questionGroupId);
        const b=saved.find(r=>r.sourceId===sourceB&&r.canonical.questionGroupId);
        const serial=await serializeProblemForLibrary({...a,id:a.problemId,segments:[],segmentImages:[],answerSegmentImages:[]},{sourceId:sourceB,librarySourceKey:'thelab4you',librarySourceName:'더랩포유',textbookName:'R2 격리 교재',fileName:'source-change.json'});
        const cloned=structuredClone([saved[0],saved[1]]);cloned[0].canonical.answerText='';cloned[0].canonical.explanationText='① Must not infer';C.derive(cloned[0]);
        const original=JSON.stringify(cloned),returns=cloned.map(repairOcrStolenInitialAnswerFields),count=repairOcrStolenInitialAnswersInList(cloned);
        const legacy={kind:'problem',answerText:'1',explanationText:'Ordinary explanation.',isSubjective:false};
        const legacyBefore=JSON.stringify(legacy),legacyCount=repairOcrStolenInitialAnswersInList([legacy]),legacyChanged=JSON.stringify(legacy)!==legacyBefore,legacyAgain=repairOcrStolenInitialAnswersInList([legacy]);
        const pairs=[a,b].map(r=>getTailPackRecordsByKey(createTailPackKey(r)).map(r=>r.canonical.groupOrder));
        const partial=C.prepareEntries([{record:b}]).find(e=>e.record.canonicalDisplay==='child').record.canonical;
        return {serial,keys:[getPassageReferenceKey(a),getPassageReferenceKey(b)],pairs,partial,ocr:{returns:returns.map(v=>typeof v==='boolean'?v:typeof v),count,unchanged:original===JSON.stringify(cloned),answers:cloned.map(r=>r.canonical.answerText),legacyCount,legacyChanged,legacyAgain}};
      },{saved,input,sourceA,sourceB});
      actual.pairs.forEach(orders=>assert.deepEqual(orders,before?[1,1,2,2]:[1,2]));
      if(!before){assert.equal(actual.serial.canonicalDocumentId,sourceB);assert.notEqual(...actual.keys);}
      assert.equal(actual.partial.groupSize,2);assert.equal(actual.partial.groupOrder,1);
      assert.deepEqual(actual.serial.canonical,target.canonical);assert.deepEqual(actual.serial.canonicalSource,target.canonicalSource);
      assert.equal(actual.ocr.count,before?2:0);assert.deepEqual(actual.ocr.returns,before?['object','object']:[false,false]);assert(actual.ocr.unchanged);
      assert.equal(actual.ocr.answers[0],'');assert.match(actual.ocr.answers[1],/\n/);
      assert.equal(actual.ocr.legacyCount,Number(actual.ocr.legacyChanged));assert.equal(actual.ocr.legacyCount,1);assert.equal(actual.ocr.legacyAgain,0);
      pass(name+' R2 serializer/group/passage/partial metadata and R3 exact boolean/nonmutation/legacy',{pairs:actual.pairs,ocr:actual.ocr});
      if(!before){
        const shared=await page.evaluate(async({saved,sourceA,sourceB})=>{
          const C=PDFLabCanonical,b=saved.find(r=>r.sourceId===sourceB&&r.canonical.questionGroupId);
          const old={id:'shared',kind:'shared',number:null,groupLabel:b.canonical.questionGroupId,sourceId:sourceA,canonicalSharedFor:JSON.stringify([sourceA,b.canonical.questionGroupId]),segments:[],segmentImages:[],answerSegments:[],answerSegmentImages:[],textOnly:true};
          const source={sourceId:sourceB,librarySourceKey:'thelab4you',librarySourceName:'더랩포유',textbookName:'R2 격리 교재',fileName:'source-change.json'};
          const record=await serializeProblemForLibrary(old,source);
          state.selectedLibrarySourceKey=source.librarySourceKey;state.selectedTextbookName=source.textbookName;state.fileName=source.fileName;
          const snapshot=await serializeProblemForSavedWork(old),restored=hydrateProblemFromSavedWork(snapshot);
          const work=await serializeProblemForSavedWork({...b,sourceId:sourceA,canonicalDocumentId:sourceA,segments:[],segmentImages:[],answerSegmentImages:[]});
          // Read old mismatched metadata without modifying the persisted document.
          const stale={...b,canonicalDocumentId:sourceA},staleBefore=JSON.stringify(stale);
          const key=createTailPackKey(stale),passage=getPassageReferenceKey(stale);
          if(staleBefore!==JSON.stringify(stale))throw Error('Read path migrated record');
          state.libraryCache.problemRecords=[...saved,record];
          const pack=getTailPackRecordsByKey(key),prepared=C.prepareEntries(pack.map(record=>({record})));
          return {key,passage,expected:C.groupKey(b),sharedKey:record.canonicalSharedFor,workKey:restored.canonicalSharedFor,workDoc:work.canonicalDocumentId,packCount:pack.length,sharedCount:prepared.filter(e=>e.record.kind==='shared').length};
        },{saved,sourceA,sourceB});
        assert.equal(shared.key,shared.expected);assert.equal(shared.passage,shared.expected);assert.equal(shared.sharedKey,shared.expected);assert.equal(shared.workKey,shared.expected);assert.equal(shared.workDoc,sourceB);assert.equal(shared.packCount,3);assert.equal(shared.sharedCount,1);
        pass(name+' R2 shared link/work serializer/stale read scoping without DB migration',shared);
      }
      const rendered=await page.evaluate(async input=>{
        const C=PDFLabCanonical,p=input.problems[3],record=C.create(p,input,'r1','synthetic.json',{id:'r1',recordId:'r1',kind:'problem',number:p.number,textOnly:true});
        const settings={...readExamExportSettings(),title:'R1',logoSrc:'',contentRenderMode:'text',includeAnswerKey:true};
        readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>[{record}];
        const sourceBefore=JSON.stringify(record);const output=await buildExamPreviewDocument('previewUrls');
        if(JSON.stringify(record)!==sourceBefore)throw Error('Rendering changed canonical');
        return output;
      },input);
      previewHtml=rendered.html;await page.goto(origin+'/qa-preview.html');
      const renderedPositions=await page.evaluate(()=>{
        const body=document.querySelector('[data-canonical-field="bodyText"]');
        const positions=body.textContent.match(/[①-⑳]/g),answer=document.querySelector('.answer-key-answer').textContent.replace(/^답:\s*/,'');
        return {positions,answer,targets:positions.filter(p=>p===answer).length};
      });
      assert.deepEqual(renderedPositions.positions,before?['①','①','②']:['①','②','③']);assert.equal(renderedPositions.answer,'①');assert.equal(renderedPositions.targets,before?2:1);
      pass(name+' R1 actual output path insertion positions and answer correspondence',renderedPositions);
      if(before)continue;
      await goto(name);
      const cases=await page.evaluate(async({input,p05})=>{
        const C=PDFLabCanonical,p=input.problems[3],tests=[];
        const render=changes=>{const q={...structuredClone(p),...changes};const before=JSON.stringify(q),record=C.create(q,input,'r1','derived.json',{id:'r1',recordId:'r1',kind:'problem',number:q.number,textOnly:true});
          const html=C.render(record);if(before!==JSON.stringify(q))throw Error('Mutated original');const el=document.createElement('div');el.innerHTML=html;return {html,positions:[...el.querySelectorAll('[data-insertion-position]')].map(e=>e.dataset.insertionPosition)};};
        tests.push({name:'tokens only',...render({bodyText:'[[s]] One. [[slot]] Two. [[s]] Three.',answerText:'②'})});
        tests.push({name:'one problem counter across fields; question circle is reference',...render({questionText:'Reference ( ① ) remains.',givenText:'[[s]] Given.',bodyText:'[[slot]] Body.',summaryText:'[[slot]] Summary.',answerText:'③'})});
        tests.push({name:'tail actual insertion subtype',...render({problemType:'꼬리',tailSubType:'삽입',questionGroupId:'derived',groupOrder:1,groupSize:1})});
        const failures=[];
        for(const changes of [{bodyText:'( ① ) One. ( ① ) Two.'},{bodyText:'( ② ) One. [[s]] Two.'},{answerText:'⑤'},{answerText:'the second position'}]){
          const q={...structuredClone(p),...changes},record=C.create(q,input,'r1','derived.json',{id:'r1',recordId:'r1',kind:'problem',textOnly:true});
          const settings={...readExamExportSettings(),contentRenderMode:'text',logoSrc:''};readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>[{record}];
          let error='';try{await buildExamPreviewDocument('previewUrls');}catch(e){error=e.message;}
          if(!error)throw Error('Ambiguous insertion unexpectedly completed');failures.push(error);
        }
        const originals=p05.problems.filter(p=>p.problemType==='삽입').map(q=>{const r=render(q);return {number:q.number,positions:r.positions,answer:q.answerText};});
        const tokens=render({questionText:'[[u:[working / to work]]] [[blank]] [[blank:A]] [[box:A:is|are]] [[unknown:<img>]] [[u:open'}).html;
        const group=input.problems.slice(5).map((original,i)=>C.create({...original,bodyText:p.bodyText,givenText:'',summaryText:'',tailSubType:i?'삽입':'제목',answerText:'①'},input,'tail-insertion','derived.json',{id:'tail-'+i,recordId:'tail-'+i,kind:'problem',textOnly:true}));
        getExamSlotAssignedRecords=()=>group.map(record=>({record}));
        const preview=await buildExamPreviewDocument('previewUrls'),doc=new DOMParser().parseFromString(preview.html,'text/html');
        const tailPositions=[...doc.querySelectorAll('[data-insertion-position]')].map(e=>e.dataset.insertionPosition);
        return {tests,failures,originals,tokens,tailPositions,tailShared:doc.querySelectorAll('[data-canonical-display="shared"]').length};
      },{input,p05});
      cases.tests.forEach(t=>assert.deepEqual(t.positions,['①','②','③']));
      cases.failures.forEach(e=>assert.match(e,/4번.*삽입 위치/));
      assert(cases.originals.length>0);cases.originals.forEach(p=>{assert.equal(new Set(p.positions).size,p.positions.length);assert.equal(p.positions.filter(x=>x===p.answer).length,1);});
      assert.match(cases.tokens,/<u><strong/);assert.match(cases.tokens,/&lt;img&gt;/);assert.match(cases.tokens,/canonical-token-warning/);assert(!cases.tokens.includes('<img>'));
      assert.deepEqual(cases.tailPositions,['①','②','③']);assert.equal(cases.tailShared,1);
      pass(name+' R1 derived boundaries, ambiguity blocked by actual output, original P05/plain and token safety',{cases:cases.tests.map(t=>({name:t.name,positions:t.positions})),failures:cases.failures,p05:cases.originals,tailPositions:cases.tailPositions,tailShared:cases.tailShared});
    }
    assert.deepEqual(errors,[]);result.status='PASS';
  }finally{await browser.close();}
})().catch(e=>{result.status='FAIL';result.failure=e.stack;console.error(e);process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(out,before?'BEFORE_BROWSER.json':'AFTER_BROWSER.json'),JSON.stringify(result,null,2)));
