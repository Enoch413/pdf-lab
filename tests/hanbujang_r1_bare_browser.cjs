// R1 remaining case: actual upload and each screen's actual output; no live network/profile/DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(path.join(process.env.PDFLAB_NODE_MODULES||'../node_modules','playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/hanbujang-r1-final-verification');
const origin='http://pdflab-r1-test.local';
const files=['HANBUJANG_SYNTHETIC_7.json','derived/R1_BARE_MIXED_INPUT.json','derived/R1_BARE_PLAIN_INPUT.json'];
const fixtures=files.map(file=>({file,data:JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang',file),'utf8'))}));
const results={status:'RUNNING',cases:[],fixtureHashes:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang',f))).digest('hex')]))};
function pass(name,details={}){results.cases.push({name,result:'PASS',...details});console.log('PASS '+name);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});let previewHtml='';
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
      if(url.pathname==='/qa-preview.html')return route.fulfill({body:previewHtml,contentType:'text/html; charset=utf-8'});
      if(/firebase.*config/i.test(url.pathname))return route.fulfill({body:'/* isolated, no live config */',contentType:'text/javascript'});
      const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!['app','dist/solbook_question_maker_portable'].some(p=>target.startsWith(path.join(root,p)+path.sep)))return route.abort();
      if(!fs.existsSync(target)||!fs.statSync(target).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(target),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(target)]||'application/octet-stream'});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const goto=async name=>{await page.goto(origin+'/app/'+name+'.html?workspace=library');await page.waitForFunction(()=>document.body.dataset.appReady==='true');};
    await goto('index');
    const records=[];
    for(const fixture of fixtures){
      await page.evaluate(()=>{clearAll();elements.newTextbookInput.value='R1 isolated review';});
      await page.locator('#problemJsonInput').setInputFiles({name:path.basename(fixture.file),mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.data))});
      await page.waitForFunction(()=>!state.isBusy&&state.problems.length===7);
      const imported=await page.evaluate(async()=>{
        const canonical=state.problems.map(p=>p.canonical);
        const source={sourceId:state.problems[0].canonicalDocumentId,librarySourceKey:state.selectedLibrarySourceKey,textbookName:state.selectedTextbookName,fileName:state.fileName};
        const saved=await Promise.all(state.problems.map(p=>serializeProblemForLibrary(p,source)));
        return {canonical,saved};
      });
      assert.deepEqual(imported.canonical,fixture.data.problems);assert.deepEqual(imported.saved.map(r=>r.canonical),fixture.data.problems);
      records.push(...imported.saved);pass('actual file upload and serializer preserve all canonical fields: '+fixture.file);
    }
    for(const screen of ['index','final_test','general_exam']){
      await goto(screen);
      const preview=await page.evaluate(async records=>{
        const original=JSON.stringify(records);state.libraryCache.problemRecords=records;
        const settings={...readExamExportSettings(),title:'R1 explicit positions QA',subtitle:'Parenthesized / bare mixed / bare plain',logoSrc:'',contentRenderMode:'text',includeAnswerKey:true};
        readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>records.map(record=>({record}));
        const output=await buildExamPreviewDocument('previewUrls');
        if(original!==JSON.stringify(records))throw Error('Output mutated stored input');return output;
      },records);
      assert.equal(preview.renderedQuestionCount,21);previewHtml=preview.html;
      await page.goto(origin+'/qa-preview.html');await page.evaluate(()=>document.fonts.ready);
      const visible=await page.evaluate(()=>{
        const questions=[...document.querySelectorAll('[data-canonical-number="4"]')];
        return questions.map((question,i)=>{
          const body=question.querySelector('[data-canonical-field="bodyText"]'),text=body.textContent;
          const answer=document.querySelectorAll('.answer-key-answer')[3+i*7].textContent.replace(/^답:\s*/,'');
          return {body:text,visiblePositions:text.match(/[①-⑳]/g),recognizedPositions:[...body.querySelectorAll('[data-insertion-position]')].map(e=>e.dataset.insertionPosition),answer,outputNumber:4+i*7};
        });
      });
      assert.equal(visible.length,3);
      visible.forEach((v,i)=>{
        const p=fixtures[i].data.problems[3];
        assert.equal(v.body,p.bodyText.replace('[[s]]','②').replace('[[slot]]','③'));
        assert.deepEqual(v.visiblePositions,['①','②','③']);assert.deepEqual(v.recognizedPositions,v.visiblePositions);
        assert.equal(v.answer,p.answerText);assert.equal(v.visiblePositions.filter(m=>m===v.answer).length,1);
      });
      await page.pdf({path:path.join(out,screen+'-r1-bare.pdf'),preferCSSPageSize:true,printBackground:true});
      pass(screen+' actual output: all three visible bodies and unique answer target; new PDF',{questions:visible});
      await goto(screen);
      const boundaries=await page.evaluate(async input=>{
        const C=PDFLabCanonical,base=input.problems[3],checks=[];
        const build=async changes=>{
          const p={...structuredClone(base),...changes},record=C.create(p,input,'boundaries','derived.json',{id:'r1',recordId:'r1',kind:'problem',textOnly:true});
          const original=JSON.stringify(record);
          const settings={...readExamExportSettings(),logoSrc:'',contentRenderMode:'text',includeAnswerKey:true};readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>[{record}];
          const output=await buildExamPreviewDocument('previewUrls');
          if(original!==JSON.stringify(record))throw Error('Boundary case mutated canonical');
          const doc=new DOMParser().parseFromString(output.html,'text/html'),body=doc.querySelector('[data-canonical-field="bodyText"]');
          return {body:body.textContent,positions:[...body.querySelectorAll('[data-insertion-position]')].map(e=>e.dataset.insertionPosition)};
        };
        for(const prefix of ['The sign read "Number ⑨. (⑧) is a reference." ',"The sign read 'Number ⑨. (⑧) is a reference.' ",'The sign read “Number ⑨. (⑧) is a reference.” ','The sign read ‘Number ⑨. (⑧) is a reference.’ ','The sign read "A [[u:marked]] ⑨. (⑧) is a reference." ','The sign [[u:⑨ and (⑧)]] was visible. ']){
          checks.push({prefix,...await build({bodyText:prefix+base.bodyText,questionText:'Reference ⑨ / (⑧).',choices:[{marker:'①',text:'See ⑨ / (⑧).'}]})});
        }
        checks.push({prefix:'apostrophes',...await build({bodyText:"It's quiet. ① People aren't asleep. [[s]] Music begins. [[slot]] People gather."})});
        checks.push({prefix:'line boundaries',...await build({bodyText:'① First sentence.\n② Second sentence.\n③ Last sentence.'})});
        const blocked=[];
        for(const bodyText of ['The reference ⑨ is ambiguous. '+base.bodyText,'A. ① B. ① C.','A. ② B. [[s]] C.']){
          let error='';try{await build({bodyText});}catch(e){error=e.message;}if(!error)throw Error('Ambiguous input completed');blocked.push(error);
        }
        // A tail group's first child is not insertion; the second child's actual type governs the body.
        const tail=input.problems.slice(5).map((p,i)=>C.create({...p,bodyText:base.bodyText,givenText:'',summaryText:'',tailSubType:i?'삽입':'제목',answerText:'①'},input,'tail','tail.json',{id:'tail-'+i,recordId:'tail-'+i,kind:'problem',textOnly:true}));
        getExamSlotAssignedRecords=()=>tail.map(record=>({record}));
        const tailBefore=JSON.stringify(tail),output=await buildExamPreviewDocument('previewUrls');
        if(tailBefore!==JSON.stringify(tail))throw Error('Tail mutated');
        const doc=new DOMParser().parseFromString(output.html,'text/html'),body=doc.querySelector('[data-canonical-display="shared"] [data-canonical-field="bodyText"]');
        return {checks,blocked,tail:{visible:body.textContent.match(/[①-⑳]/g),positions:[...body.querySelectorAll('[data-insertion-position]')].map(e=>e.dataset.insertionPosition),sharedCount:doc.querySelectorAll('[data-canonical-display="shared"]').length}};
      },fixtures[1].data);
      boundaries.checks.forEach(c=>assert.deepEqual(c.positions,['①','②','③']));
      boundaries.checks.slice(0,6).forEach(c=>{assert(c.body.includes('⑨'));assert(c.body.includes('⑧'));});
      boundaries.blocked.forEach(e=>assert.match(e,/4번.*삽입 위치/));
      assert.deepEqual(boundaries.tail.visible,['①','②','③']);assert.deepEqual(boundaries.tail.positions,boundaries.tail.visible);assert.equal(boundaries.tail.sharedCount,1);
      pass(screen+' actual output: references/quotes/underline excluded, ambiguity blocked, tail actual type',boundaries);
    }
    assert.deepEqual(errors,[]);results.status='PASS';
  }finally{await browser.close();}
})().catch(e=>{results.status='FAIL';results.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(out,'R1_BROWSER_RESULTS.json'),JSON.stringify(results,null,2)));
