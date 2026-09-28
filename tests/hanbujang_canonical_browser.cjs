// Isolated user-path QA. Never connects to live Firebase or a user browser profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PDFLAB_NODE_MODULES ? path.join(process.env.PDFLAB_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tmp/hanbujang-verification');
const origin = 'http://pdflab-test.local';
const fixtures = ['P05_CANONICAL_ACTUAL', 'HANBUJANG_SYNTHETIC_7'].map(name => ({ name, data: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hanbujang', name+'.json'), 'utf8')) }));
const results = { status: 'RUNNING', environment: { node: process.version, browser: 'headless Edge, new context', network: 'all external requests aborted; firebase-config disabled', firebase: 'memory SDK mock', folder: 'test directory through FileSystem handle adapter' }, cases: [], fixtureHashes: {} };
function pass(name, details) { results.cases.push({ name, result: 'PASS', ...details }); console.log('PASS '+name); }
function same(records, input) { assert.deepEqual(records.map(r => r.canonical).sort((a,b)=>a.number-b.number), [...input].sort((a,b)=>a.number-b.number)); }
for(const f of fixtures) results.fixtureHashes[f.name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang',f.name+'.json'))).digest('hex');

async function mockFirebase(page) {
  await page.evaluate(() => {
    window.qaRemote = new Map(); window.qaBatchCommits = [];
    const doc = (name, id) => ({ name, id,
      set: async (value, options) => { const key=name+'/'+id; qaRemote.set(key, { ...(options?.merge ? qaRemote.get(key) || {} : {}), ...structuredClone(value) }); },
      get: async () => ({ id, exists: qaRemote.has(name+'/'+id), data: () => structuredClone(qaRemote.get(name+'/'+id)) }),
      delete: async () => { qaRemote.delete(name+'/'+id); }
    });
    const collection = name => ({ doc: id => doc(name,id),
      get: async () => ({ docs: [...qaRemote.entries()].filter(([k])=>k.startsWith(name+'/')).map(([k,v])=>({id:k.slice(name.length+1),data:()=>structuredClone(v)})) }),
      where: (field,op,value) => ({ get: async () => ({ docs: [...qaRemote.entries()].filter(([k,v])=>k.startsWith(name+'/') && v[field]===value).map(([k,v])=>({id:k.slice(name.length+1), data:()=>structuredClone(v), ref:doc(name,k.slice(name.length+1))})) }) })
    });
    state.firebaseSchoolBridge.db = { collection, batch: () => {
      const pending=[]; return { set: (ref,value,options)=>pending.push({ref,value,options}), commit:async()=>{for(const p of pending) await p.ref.set(p.value,p.options);qaBatchCommits.push(pending.length);} };
    } };
    state.firebaseSchoolBridge.storage = { ref: () => { throw new Error('Unexpected Storage network/image operation'); } };
    getSharedFirebaseLibraryAccessState = () => ({ enabled: true });
    ensureExplicitLibrarySaveTargetsReady = async () => {};
    syncSelectedLibraryDestinations = async (source,records,options) => ({ mode:'firebase', firebase: options.skipFirebase ? {attempted:false} : {attempted:true,...await syncSourceRecordToSharedFirebaseLibrary(source,records)}, folder:{attempted:false,synced:false} });
  });
}

(async () => {
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    let previewHtml='';
    await context.route('**/*', route=> {
      const url=new URL(route.request().url());
      if(url.origin!==origin) return route.abort();
      if(url.pathname==='/qa-preview.html') return route.fulfill({body:previewHtml,contentType:'text/html; charset=utf-8'});
      if(/firebase.*config/i.test(url.pathname)) return route.fulfill({body:'/* isolated QA: no live config */',contentType:'text/javascript'});
      const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!['app','dist/solbook_question_maker_portable'].some(p=>target.startsWith(path.join(root,p)+path.sep)))return route.abort();
      if(!fs.existsSync(target)||!fs.statSync(target).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(target),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(target)]||'application/octet-stream'});
    });
    const page=await context.newPage();const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message)); page.on('dialog',d=>d.accept());
    await page.exposeFunction('qaFolderWrite',async(name,data)=>{assert.equal(path.basename(name),name);fs.mkdirSync(path.join(out,'folder'),{recursive:true});fs.writeFileSync(path.join(out,'folder',name),data);});
    await page.exposeFunction('qaFolderRead',async name=>{assert.equal(path.basename(name),name);const f=path.join(out,'folder',name);return fs.existsSync(f)?fs.readFileSync(f,'utf8'):null;});
    const goto=async(name='index',workspace='library')=>{await page.goto(origin+'/app/'+name+'.html?workspace='+workspace);await page.waitForFunction(()=>document.body.dataset.appReady==='true');};
    await goto();
    const schema=JSON.parse(fs.readFileSync(path.join(root,'docs/hanbujang-contract/CANONICAL_SCHEMA.json'),'utf8'));
    const contract=await page.evaluate(()=>({fields:PDFLabCanonical.fields,types:PDFLabCanonical.types}));
    assert.deepEqual(contract.fields,schema.properties.problems.items.required);
    assert.deepEqual(contract.types,schema.properties.problems.items.properties.problemType.enum);
    pass('contract field/type definitions match shipped schema');
    const invalid=await page.evaluate(input=>{
      elements.newTextbookInput.value='격리 QA 교재';
      const cases=[['string boolean',p=>p.problems[0].isSubjective='false'],['null',p=>p.problems[0].givenText=null],['duplicate number',p=>p.problems[1].number=1],['gap number',p=>p.problems[1].number=99],['incomplete canonical',p=>delete p.problems[0].rawText],['mixed legacy',p=>p.problems[1]={number:2,body:'legacy'}],['group size',p=>p.problems.at(-1).groupSize=8],['duplicate order',p=>p.problems.at(-1).groupOrder=1],['different body',p=>p.problems.at(-1).bodyText+='x'],['unknown field',p=>p.problems[0].extra=1],['duplicate marker',p=>p.problems[0].choices[1].marker='①']];
      const before=JSON.stringify(state.problems);return cases.map(([name,mutate])=>{
        const p=structuredClone(input);mutate(p);let error='';try{applyAiProblemJsonPayload(p,'bad.json');}catch(e){error=e.message;}
        if(!error||before!==JSON.stringify(state.problems))throw new Error('Not atomic: '+name);
        return {name,error};
      });
    },fixtures[1].data);
    pass('invalid/mixed canonical rejected before state mutation',{cases:invalid});
    const token=await page.evaluate(()=>PDFLabCanonical.inline('before [[u:[working / to work]]] after\n(A) ____ ( ① ) (B) [what / that] [[blank]] [[blank:A]] [[box:A:is|are]] [[s]] [[slot]] [[unknown:<script>]] [[u:open'));
    assert.match(token.html,/<u><strong.*\[working \/ to work\]<\/strong><\/u> after/);
    assert.match(token.html,/&lt;script&gt;/);assert.equal(token.warnings.length,2);
    pass('nested/plain/known/unknown/unclosed tokens',{warnings:token.warnings});
    const allStored=[];
    for(const f of fixtures) {
      await page.evaluate(()=>{clearAll();elements.newTextbookInput.value='격리 QA 교재';});
      await page.locator('#problemJsonInput').setInputFiles({name:f.name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.data))});
      await page.waitForFunction(n=>!state.isBusy&&state.problems.length===n,f.data.problems.length);
      same(await page.evaluate(()=>state.problems),f.data.problems);
      assert.match(await page.locator('#problemJsonSummary').textContent(),/별도 보존/);
      await mockFirebase(page);
      const saved=await page.evaluate(async()=>{
        await saveProblemsToLibrary();
        const first=await loadAllRecordsFromStore(LIBRARY_PROBLEM_STORE);
        await saveProblemsToLibrary(); // same source replacement, not append
        const second=await loadAllRecordsFromStore(LIBRARY_PROBLEM_STORE);
        const remote=await loadSharedLibrarySnapshotFromFirebase();
        const currentSource=(await loadAllRecordsFromStore(LIBRARY_IMPORT_STORE)).find(r=>r.fileName===state.fileName);
        const current=second.filter(r=>r.sourceId===currentSource.sourceId);
        const shorter=current.filter(r=>!r.canonical.questionGroupId);
        await syncSourceRecordToSharedFirebaseLibrary(currentSource,shorter);
        const reduced=await loadSharedLibrarySnapshotFromFirebase();
        if(reduced.problemRecords.filter(r=>r.sourceId===currentSource.sourceId).length!==shorter.length)throw new Error('Same source did not remove stale group');
        const legacy=shorter.map(r=>{const copy={...r};delete copy.canonical;delete copy.canonicalSource;delete copy.canonicalDocumentId;delete copy.canonicalDisplay;return copy;});
        await syncSourceRecordToSharedFirebaseLibrary(currentSource,legacy);
        const legacyReload=await loadSharedLibrarySnapshotFromFirebase();
        if(legacyReload.problemRecords.filter(r=>r.sourceId===currentSource.sourceId).some(PDFLabCanonical.has))throw new Error('Legacy re-registration inherited stale canonical');
        await syncSourceRecordToSharedFirebaseLibrary(currentSource,current);
        await saveCurrentRepackWork();const workId=state.loadedRepackWorkId;
        state.problems=[];await loadSavedWork(workId);
        const restored=structuredClone(state.problems);
        const snapshot=await createLibrarySnapshotFromState();
        const handle={getFileHandle:async name=>({getFile:async()=>{const s=await qaFolderRead(name);if(s===null)throw new DOMException('missing','NotFoundError');return new File([s],name);},createWritable:async()=>({write:async data=>qaFolderWrite(name,data),close:async()=>{}})})};
        await writeLibrarySnapshotToDirectory(handle,snapshot);
        const folder=await readLibrarySnapshotFromDirectory(handle);
        return {first,second,remote,restored,folder};
      });
      const filter=records=>records.filter(r=>r.canonicalSource?.uploadFileName===f.name+'.json');
      same(filter(saved.first),f.data.problems);same(filter(saved.second),f.data.problems);
      same(filter(saved.remote.problemRecords),f.data.problems);same(saved.restored,f.data.problems);same(filter(saved.folder.problemRecords),f.data.problems);
      assert.equal(saved.first.length,saved.second.length);
      allStored.push(...filter(saved.second));
      pass(f.name+' actual file upload → library save/replacement → Firebase mock reload → work save/load → folder roundtrip',{questions:f.data.problems.length});
      await page.reload();await page.waitForFunction(()=>document.body.dataset.appReady==='true');
      same(filter(await page.evaluate(()=>state.libraryCache.problemRecords)),f.data.problems);
      pass(f.name+' browser reload IndexedDB exact canonical equality');
    }
    const synthetic=allStored.filter(r=>r.canonicalSource.uploadFileName===fixtures[1].name+'.json');
    const group=synthetic.filter(r=>r.canonical.questionGroupId);
    assert.equal(group.length,2);
    await mockFirebase(page);
    await page.evaluate(records=>{for(const r of records)qaRemote.set(FIREBASE_SHARED_LIBRARY_PROBLEM_COLLECTION+'/'+r.recordId,r);},allStored);
    await page.evaluate(id=>openLibraryTextEditor('stored',id),group[0].recordId);
    await page.locator('[data-canonical-edit="bodyText"]').fill('Edited common body.\n  Preserved spaces.');
    await page.locator('[data-canonical-edit="questionText"]').fill('');
    await page.locator('#libraryTextEditorAnswerTextarea').fill('');
    await page.evaluate(()=>saveLibraryTextEditorChanges());
    const edits=await page.evaluate(()=>({records:state.libraryCache.problemRecords,remote:[...qaRemote.values()],batches:qaBatchCommits}));
    const expected=structuredClone(synthetic);
    expected.forEach(r=>{if(r.canonical.questionGroupId)r.canonical.bodyText='Edited common body.\n  Preserved spaces.';if(r.recordId===group[0].recordId){r.canonical.questionText='';r.canonical.answerText='';}});
    same(edits.records.filter(r=>r.canonicalSource?.uploadFileName===fixtures[1].name+'.json'),expected.map(r=>r.canonical));
    same(edits.remote.filter(r=>r.canonicalSource?.uploadFileName===fixtures[1].name+'.json'),expected.map(r=>r.canonical));
    assert.deepEqual(edits.batches,[2]);
    await page.evaluate(id=>openLibraryTextEditor('stored',id,{forceDiscard:true}),group[0].recordId);
    assert.equal(await page.locator('[data-canonical-edit="questionText"]').inputValue(),'');
    assert.equal(await page.locator('#libraryTextEditorAnswerTextarea').inputValue(),'');
    pass('real stored editor: empty values stay empty; common body updates group atomically; exact intended diff; reopen',{firebaseBatchSizes:edits.batches});
    const boundaries=await page.evaluate(records=>{
      const C=PDFLabCanonical, group=records.filter(r=>r.canonical.questionGroupId), independent=records.filter(r=>!r.canonical.questionGroupId);
      let deleted='';try{C.guardDelete(group[0]);}catch(e){deleted=e.message;}
      const other=structuredClone(group);other.forEach(r=>{r.sourceId+='other-document';r.canonicalDocumentId=r.sourceId;});
      const prepared=C.prepareEntries([...group].reverse().concat(other,independent).map(record=>({record})));
      const groups=prepared.filter(e=>e.record.canonicalDisplay==='shared');
      const subset=C.prepareEntries([{record:group[1]}]);
      return {deleted,groups:groups.length,orders:prepared.filter(e=>e.record.canonicalDisplay==='child').map(e=>e.record.canonical.groupOrder),partial:subset.map(e=>({display:e.record.canonicalDisplay,size:e.record.canonical.groupSize,order:e.record.canonical.groupOrder})),independent:prepared.filter(e=>!e.record.canonical.questionGroupId).length};
    },synthetic);
    assert.match(boundaries.deleted,/단독 삭제/);assert.equal(boundaries.groups,2);assert.deepEqual(boundaries.orders,[1,2,1,2]);assert.equal(boundaries.partial.length,2);assert.equal(boundaries.partial[1].size,2);assert.equal(boundaries.independent,5);
    pass('cross-document same ID / reverse order / partial selection / independent labels / deletion guard',boundaries);
    const overlay = await page.evaluate(async input => {
      clearAll(); elements.newTextbookInput.value='격리 QA 교재';
      const C=PDFLabCanonical;
      const segments=[{pageIndex:0,x0:0,x1:100,y0:0,y1:120}], images=[{url:'data:image/png;base64,QA',width:100,height:120}];
      state.fileName=input.sourceName;
      state.problems=input.problems.map(p=>({id:'pdf-'+p.number,kind:'problem',number:p.number,groupLabel:p.questionGroupId?'legacy-tail':'',segments,segmentImages:images,answerSegments:[],answerSegmentImages:[],contentMode:'image'}));
      state.problems.push({id:'shared',kind:'shared',groupLabel:'legacy-tail',segments,segmentImages:images,answerSegments:[],answerSegmentImages:[]});
      const before=JSON.stringify(state.problems);let rejected='';
      try{applyAiProblemJsonPayload({...input,sourceName:'wrong.pdf'},'overlay.json');}catch(e){rejected=e.message;}
      if(before!==JSON.stringify(state.problems))throw new Error('Overlay error changed state');
      applyAiProblemJsonPayload(input,'overlay.json');
      const questions=state.problems.filter(p=>p.kind==='problem');
      if(!questions.every(p=>p.segmentImages===images&&p.segments===segments))throw new Error('Overlay lost images');
      const shared=state.problems.find(p=>p.kind==='shared');
      if(!shared?.canonicalSharedFor||shared.segmentImages!==images)throw new Error('Overlay lost shared image');
      const sharedSnapshot={...shared,...C.metadata(shared),segmentBlobs:[],answerSegmentBlobs:[]};
      if(hydrateProblemFromSavedWork(sharedSnapshot).canonicalSharedFor!==shared.canonicalSharedFor)throw new Error('Overlay shared link lost on work restoration');
      const prepared=C.prepareEntries(state.problems.map(record=>({record})));
      if(prepared.filter(e=>e.record.kind==='shared').length!==1)throw new Error('Duplicate shared body');
      let deleteError='';try{removeCurrentImportedProblem(questions.at(-1).id);}catch(e){deleteError=e.message;}
      clearAll();applyAiProblemJsonPayload(input,'edited-work.json');
      openLibraryTextEditor('current',state.problems[1].id,{forceDiscard:true});
      const field=elements.libraryTextEditorStructuredFields.querySelector('[data-canonical-edit="givenText"]');
      field.value='  Given\nindependently  ';field.dispatchEvent(new Event('input',{bubbles:true}));
      renderLibraryTextEditor();if(elements.libraryTextEditorStructuredFields.querySelector('[data-canonical-edit="givenText"]').value!=='  Given\nindependently  ')throw new Error('Rerender lost edit');
      elements.libraryTextEditorAnswerTextarea.value='(1) changed\n(2) second';
      await saveLibraryTextEditorChanges();
      await saveCurrentRepackWork();const workId=state.loadedRepackWorkId;
      state.problems=[];await loadSavedWork(workId);
      const work=state.problems.map(r=>r.canonical);
      clearAll();
      const variants=structuredClone(input);
      variants.problems[0].choices=variants.problems[0].choices.slice(0,4).reverse();
      variants.problems[2].choices=Array.from({length:6},(_,i)=>({marker:String(6-i),text:'Choice '+i}));
      variants.problems[0].answerText='';variants.problems[0].explanationText='① must not become the answer';
      variants.problems[0].passageLabel=variants.problems[1].passageLabel='[same-independent]';
      applyAiProblemJsonPayload(variants,'choices.json');
      const record=await serializeProblemForLibrary(state.problems[0],{sourceId:'qa',librarySourceKey:'neoreunteo',textbookName:'QA',fileName:'choices.json'});
      return {rejected,deleteError,overlayCount:questions.length,work,variant:state.problems.map(r=>r.canonical),answer:record.answerText,distinctPassageKeys:getPassageReferenceKey(state.problems[0])!==getPassageReferenceKey(state.problems[1])};
    },fixtures[1].data);
    assert.match(overlay.rejected,/overlay/);assert.match(overlay.deleteError,/단독 삭제/);assert.equal(overlay.overlayCount,7);
    const editedWork=structuredClone(fixtures[1].data.problems);editedWork[1].givenText='  Given\nindependently  ';editedWork[1].answerText='(1) changed\n(2) second';
    assert.deepEqual(overlay.work,editedWork);assert.equal(overlay.variant[0].choices.length,4);assert.equal(overlay.variant[2].choices.length,6);assert.equal(overlay.variant[0].choices[0].marker,'④');assert.equal(overlay.answer,'');assert.equal(overlay.distinctPassageKeys,true);
    pass('actual PDF overlay correspondence/image preservation; current editor/work restore; 4/6 choices and markers; empty answer not inferred; independent same-label keys');
    // Real output functions use saved/reloaded records. Actual slot resolver is separately checked below.
    for(const name of ['index','final_test','general_exam']) {
      await goto(name,'exam');
      const resolved=await page.evaluate(records=>{
        state.libraryCache.problemRecords=records;
        const keys=[...new Set(records.filter(r=>r.canonical.questionGroupId).map(createTailPackKey))];
        return keys.map(key=>getTailPackRecordsByKey(key).filter(r=>r.kind==='problem').map(r=>r.canonical.groupOrder));
      },allStored);
      assert.equal(resolved.length,3);resolved.forEach(orders=>assert.deepEqual(orders,[1,2]));
      const limits=await page.evaluate(async records=>{
        const old=getExamSlotAssignedRecords, oldHydrate=hydrateProblemRecordsWithAssets;
        getExamSlotAssignedRecords=()=>records.filter(r=>r.canonical.questionGroupId).slice(0,2).reverse().map(record=>({record}));
        hydrateProblemRecordsWithAssets=async records=>records;
        const p=await buildExamProblemPayloadFromSlots('previewUrls',{renderContentMode:'text',maxQuestionCount:1});
        getExamSlotAssignedRecords=old;hydrateProblemRecordsWithAssets=oldHydrate;
        return {rendered:p.renderedQuestionCount,shared:p.problems.filter(r=>r.kind==='shared').length,children:p.problems.filter(r=>r.kind!=='shared').map(r=>({size:r.canonical.groupSize,order:r.canonical.groupOrder,number:r.canonical.number}))};
      },allStored);
      assert.equal(limits.rendered,1);assert.equal(limits.shared,1);assert.equal(limits.children[0].size,2);
      pass(name+' actual max-count cut includes common body and preserves original group metadata',limits);
      const images=await page.evaluate(async()=>{
        const blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="white"/><text y="30">image QA</text></svg>'],{type:'image/svg+xml'});
        const base={sourceId:'legacy-images',sourceName:'legacy.pdf',textbookName:'QA',librarySourceKey:'neoreunteo',groupLabel:'legacy-group',segmentBlobs:[blob],segmentMeta:[{x0:0,x1:100,y0:0,y1:80}],answerText:'①',problemType:'꼬리문제'};
        const records=[{...base,recordId:'shared-image',kind:'shared',number:null},{...base,recordId:'image-1',kind:'problem',number:1},{...base,recordId:'image-2',kind:'problem',number:2}];
        state.libraryCache.problemRecords=records;
        const pack=getTailPackRecordsByKey(createTailPackKey(records[1]));
        const runtime=pack.map((r,i)=>createExamRuntimeProblemFromRecord(r,i,'previewUrls','image'));
        const layout=buildLayoutPages(readExamExportSettings(),runtime,{repeatHeaderEveryPage:false});
        return {pack:pack.length,images:runtime.every(r=>r.segmentImages.length===1),cards:layout.sheets.flatMap(s=>s.columns.flatMap(c=>c.items)).length};
      });
      assert.deepEqual(images,{pack:3,images:true,cards:3});pass(name+' legacy shared/image runtime and layout',images);
      const stress=await page.evaluate(async record=>{
        const C=PDFLabCanonical;record.canonical.bodyText=('Long passage with [[u:[working / to work]]] and a neighbor.\n').repeat(130);
        record.canonical.givenText='Given text retained.';record.canonical.summaryText='Summary retained.';
        await PDFLabSolbookText.ready();
        const layout=buildLayoutPages(readExamExportSettings(),[C.textRuntime(record,1)],{repeatHeaderEveryPage:false});
        PDFLabSolbookText.assertFits(layout.sheets);
        const entries=layout.sheets.flatMap(s=>s.columns.flatMap(c=>c.items));
        const div=document.createElement('div');div.innerHTML=entries.map(createProblemCardMarkup).join('');
        const body=[...div.querySelectorAll('[data-canonical-field="bodyText"]')].map(el=>el.textContent).join('');
        const expected=document.createElement('div');expected.innerHTML=C.inline(record.canonical.bodyText).html;
        return {fragments:entries.length,pages:layout.sheets.length,bodyPreserved:body===expected.textContent,given:div.textContent.includes('Given text retained.'),summary:div.textContent.includes('Summary retained.')};
      },synthetic[0]);
      assert(stress.fragments>1);assert.equal(stress.bodyPreserved,true);assert.equal(stress.given,true);assert.equal(stress.summary,true);pass(name+' canonical long text paginates without text loss',stress);
      const preview=await page.evaluate(async records=>{
        const settings={...readExamExportSettings(),title:'Canonical-16 QA',subtitle:'P05 actual 191 + synthetic 7',logoSrc:'',contentRenderMode:'text',includeAnswerKey:true};
        readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>records.map(record=>({record}));
        hydrateProblemRecordsWithAssets=async records=>{if(records.length)throw new Error('Unexpected image access in text-only QA');return [];};
        return await buildExamPreviewDocument('previewUrls');
      },allStored);
      assert.equal(preview.renderedQuestionCount,198);previewHtml=preview.html;
      await page.goto(origin+'/qa-preview.html');await page.evaluate(()=>document.fonts.ready);
      const geometry=await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('.problem-card')];
        return {sheets:document.querySelectorAll('.sheet').length,cards:cards.length,shared:document.querySelectorAll('[data-canonical-display="shared"]').length,children:document.querySelectorAll('[data-canonical-display="child"]').length,
          overflow:cards.some(card=>card.getBoundingClientRect().bottom>card.closest('.sheet').getBoundingClientRect().bottom-8),
          horizontalOverflow:[...document.querySelectorAll('.solbook-stem,.solbook-body,.solbook-choice-text')].some(el=>el.scrollWidth>el.clientWidth+2),
          answer:[...document.querySelectorAll('.answer-key-answer')].find(el=>el.textContent.includes('(1) She planned'))?.textContent,
          answerWhiteSpace:getComputedStyle(document.querySelector('.answer-key-answer')).whiteSpace,
          numbers:[...document.querySelectorAll('[data-canonical-number]')].filter(el=>el.dataset.canonicalDisplay!=='shared').map(el=>Number(el.dataset.canonicalNumber))};
      });
      assert.equal(geometry.overflow,false);assert.equal(geometry.horizontalOverflow,false);assert.match(geometry.answer,/\n\(2\)/);assert.equal(geometry.answerWhiteSpace,'pre-wrap');
      for(let n=1;n<=191;n++)assert(geometry.numbers.includes(n),'Missing rendered number '+n);
      assert.equal(geometry.shared,3);assert.equal(geometry.children,6);
      const insertion=await page.evaluate(()=>{
        const body=[...document.querySelectorAll('[data-canonical-field="bodyText"]')].find(el=>el.textContent.includes('The street was quiet.'));
        const positions=[...body.querySelectorAll('[data-insertion-position]')].map(el=>el.dataset.insertionPosition);
        const answer=document.querySelectorAll('.answer-key-answer')[194]?.textContent.replace(/^답:\s*/,'');
        return {positions,answer,answerTargets:positions.filter(p=>p===answer).length,body:body.textContent};
      });
      assert.deepEqual(insertion.positions,['①','②','③']);assert.equal(insertion.answer,'①');assert.equal(insertion.answerTargets,1);
      await page.pdf({path:path.join(out,name+'-canonical.pdf'),preferCSSPageSize:true,printBackground:true});
      await page.locator('.sheet').first().screenshot({path:path.join(out,name+'-first-page.png')});
      await page.locator('.sheet').last().screenshot({path:path.join(out,name+'-last-question-page.png')});
      pass(name+' actual saved-record output: all 198 questions, three distinct groups, geometry and multiline answer',{...geometry,numbers:undefined});
      pass(name+' output 195 mixed insertion: unique positions and exactly one answer target',insertion);
    }
    assert.deepEqual(pageErrors,[]);pass('no uncaught page errors');
    results.status='PASS';
  } finally {await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}
})().catch(e=>{results.status='FAIL';results.failure=e.stack;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.error(e);process.exitCode=1;});
