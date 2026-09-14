// Isolated headless QA; never opens a user's profile or connects to Firebase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PDFLAB_NODE_MODULES ? path.join(process.env.PDFLAB_NODE_MODULES,'playwright') : 'playwright');
const records = require('./solbook_text_fixtures.cjs');
const root = path.resolve(__dirname,'..');
const out = path.join(root,'tmp/pdfs/solbook-text-qa');
fs.mkdirSync(out,{recursive:true});
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ttf':'font/ttf','.png':'image/png'};
const server = http.createServer((req,res)=>{
  const target = path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context=await browser.newContext();
    await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
    const results=[];
    for(const name of ['index','final_test']) {
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/app/'+name+'.html?workspace=exam',{waitUntil:'load'});
      await page.waitForFunction(()=>typeof buildExamPreviewDocument==='function'&&!!window.PDFLabSolbookText);
      const payload=await page.evaluate(async records=>{
        const settings={...readExamExportSettings(),pagePadding:10,columnGap:6,cardGap:3,maxPerColumn:3,kicker:'TEXT OUTPUT QA',title:'쏠북 기준 텍스트 출제',subtitle:'16개 유형 · 원문 보존 검증',logoSrc:'',contentRenderMode:'text',includeAnswerKey:false};
        readExamExportSettings=()=>settings;
        getExamSlotAssignedRecords=()=>records.map(record=>({record}));
        hydrateProblemRecordsWithAssets=async()=>{throw new Error('Text output must not load images');};
        const before=JSON.stringify(records);
        const preview=await buildExamPreviewDocument('previewUrls');
        if(JSON.stringify(records)!==before) throw new Error('Input records were mutated');
        const imageProblem={...createExamRuntimeProblemFromRecord({...records[0],segmentStoragePaths:[]},1,'previewUrls','text'),renderContentMode:'image',segmentImages:[{url:'data:image/png;base64,iVBORw0KGgo=',width:500,height:600}]};
        const imageMarkup=createProblemCardMarkup({problem:imageProblem,fitScale:1,appliedSquashPercent:0});
        if(imageMarkup.includes('solbook-text-question')||imageMarkup.includes('is-text-render')) throw new Error('Image branch was changed');
        const runtime=records.map((r,i)=>createExamRuntimeProblemFromRecord(r,i+1,'previewUrls','text'));
        const started=performance.now();
        const many=Array.from({length:320},(_,i)=>({...runtime[i%runtime.length],id:'large-'+i,displayNumber:i+1,number:i+1}));
        buildLayoutPages(settings,many);
        const durationMs=performance.now()-started;
        const huge={...runtime[0],textStructure:{questionText:'긴 본문 검증',bodyText:'A very long passage. '.repeat(2500)}};
        const longLayout=buildLayoutPages(settings,[huge]);
        PDFLabSolbookText.assertFits(longLayout.sheets);
        const longFragments=longLayout.sheets.flatMap(s=>s.columns.flatMap(c=>c.items));
        const overflowPaginated=longFragments.length>1&&longFragments.slice(1).every(e=>e.problem.textContinuation);
        return {html:preview.html,durationMs,overflowPaginated,renderedCount:preview.renderedQuestionCount};
      },records);
      assert.equal(payload.renderedCount,16);
      assert.equal(payload.overflowPaginated,true);
      assert.deepEqual(errors,[],'App startup/runtime errors');
      fs.writeFileSync(path.join(out,name+'.html'),payload.html);
      await page.goto(origin+'/tmp/pdfs/solbook-text-qa/'+name+'.html',{waitUntil:'load'});
      await page.evaluate(()=>document.fonts.ready);
      await page.emulateMedia({media:'print'});
      const geometry=await page.evaluate(()=>{
        const cards=Array.from(document.querySelectorAll('.problem-card'));
        const overflow=cards.filter(card=>{
          const parent=card.closest('.sheet');
          return card.getBoundingClientRect().bottom>parent.getBoundingClientRect().bottom-8;
        }).length;
        const textOverflow=Array.from(document.querySelectorAll('.solbook-stem,.solbook-body,.solbook-choice-text'))
          .filter(el=>el.scrollWidth>el.clientWidth+2).length;
        const text=document.body.textContent;
        return {cards:cards.length,sheets:document.querySelectorAll('.sheet').length,overflow,textOverflow,
          rawMarkers:/\[\[(?:u|blank|box|s|slot)/.test(text),tables:document.querySelectorAll('.problem-choice-part-table').length,
          font:getComputedStyle(document.querySelector('.solbook-body')).fontSize,
          stems:Array.from(document.querySelectorAll('.solbook-stem')).map(el=>el.textContent),
          texts:Array.from(document.querySelectorAll('.solbook-body')).map(el=>el.textContent)};
      });
      assert.equal(geometry.cards,16);
      assert.equal(geometry.overflow,0,'Cards overflow a printed page');
      assert.equal(geometry.textOverflow,0,'Text overflows a card');
      assert.equal(geometry.rawMarkers,false);
      assert.equal(geometry.tables,0);
      await page.pdf({path:path.join(out,name+'.pdf'),preferCSSPageSize:true,printBackground:true});
      await page.locator('.sheet').first().screenshot({path:path.join(out,name+'-page1.png')});
      results.push({name,geometry,duration320QuestionsMs:payload.durationMs,errors});
      await page.close();
    }
    assert.deepEqual(results[0].geometry.texts,results[1].geometry.texts,'Both entry points must render the same question text');
    const referencePage=await context.newPage();
    await referencePage.goto(origin+'/dist/solbook_question_maker_portable/app/solbook_question_maker.html',{waitUntil:'load'});
    const bytes=await referencePage.evaluate(async records=>{
      const questions=records.map(record=>({type:normalizeQuestionType(record.problemType),stem:record.textStructure.questionText,body:[record.textStructure.givenText,record.textStructure.bodyText,record.textStructure.summaryText].filter(Boolean).join('\n\n'),choices:record.textStructure.choices.map(choice=>choice.text),difficulty:'none'}));
      const plan={title:'쏠북 기준 비교',subtitle:'16개 유형',questions,includeAnswers:false};
      const pdf=await createDirectPdfBlobForPlan(plan);
      return Array.from(new Uint8Array(await pdf.arrayBuffer()));
    },records);
    fs.writeFileSync(path.join(out,'solbook-reference.pdf'),Buffer.from(bytes));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results.map(({geometry,...row})=>({...row,geometry:{...geometry,texts:undefined,stems:undefined}})),null,2));
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
