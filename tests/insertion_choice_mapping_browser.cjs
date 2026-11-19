// Actual shared-passage outputs. Synthetic records; production access blocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.PDFLAB_NODE_MODULES||'../node_modules','playwright'));
const root=path.resolve(__dirname,'..'),origin='http://letter-insertion.test',out=path.join(root,'tmp/insertion-letter-20261120');
const fixture=require('./fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000}});let exported='';
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/output.html')return route.fulfill({body:exported,contentType:'text/html; charset=utf-8'});
   if(/firebase.*config/i.test(url.pathname))return route.fulfill({body:'/* isolated */',contentType:'text/javascript'});
   const file=path.resolve(root,decodeURIComponent(url.pathname).slice(1));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream'});
  });
  for(const screen of ['index','final_test','general_exam']){
   const page=await context.newPage(),errors=[],missing=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)missing.push(r.url())});
   await page.goto(`${origin}/app/${screen}.html?workspace=exam`);await page.waitForFunction(()=>document.body.dataset.appReady==='true');
   const result=await page.evaluate(async fixture=>{
    await PDFLabSolbookText.ready();
    const base=fixture.problems.find(p=>p.problemType==='삽입');
    const body='It appears ⓐ [[u:what]] changes can affect a community. (A) Earlier events affected many people. (B) Contacts can spread through a community. (C) Natural barriers often prevented such contact. (D) Those barriers have changed. (E) We should consider ⓕ [[u:which]] measures will help.';
    const p={...base,number:32,problemType:'꼬리',tailSubType:'삽입',questionGroupId:'32-33',groupOrder:1,groupSize:2,questionText:'[32-33] 윗글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?',givenText:'Contacts can spread new risks.',bodyText:body,choices:Array.from('①②③④⑤',(marker,index)=>({marker,text:`(${String.fromCharCode(65+index)})`})),answerText:'③',explanationText:'정답 ③은 본문의 (C)에 대응합니다.'};
    const grammar={...p,number:33,tailSubType:'밑줄어법',groupOrder:2,questionText:'윗글의 밑줄 친 부분을 확인하시오.',givenText:'',choices:[],answerText:'ⓐ',explanationText:'독립된 어법 문항의 해설입니다.'};
    const records=[p,grammar].map(q=>PDFLabCanonical.create(q,fixture,'qa','qa.json',{kind:'problem',recordId:'q'+q.number,sourceId:'qa',textOnly:true}));
    const before=JSON.stringify(records);
    const settings={...readExamExportSettings(),title:'삽입 선택지 대응 검증',contentRenderMode:'text',includeAnswerKey:true,logoSrc:'./assets/code-logo.png'};
    readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>records.map(record=>({record}));
    const output=await buildExamPreviewDocument('previewUrls');
    if(JSON.stringify(records)!==before)throw new Error('Source changed');
    // A genuinely absent position still stops output; validation is not bypassed.
    const bad={...p,bodyText:p.bodyText.replace('(C)','')};let blocked='';
    try{PDFLabCanonical.inlineProblem(bad)}catch(error){blocked=error.message}
    return {html:output.html,blocked};
   },fixture);
   assert.match(result.blocked,/32번.*삽입 위치/);exported=result.html;
   await page.goto(origin+'/output.html');await page.evaluate(()=>document.fonts.ready);
   const proof=await page.evaluate(()=>{
    const shared=document.querySelector('[data-canonical-display="shared"]');
    return {sharedCount:document.querySelectorAll('[data-canonical-display="shared"]').length,positions:[...shared.querySelectorAll('[data-insertion-position]')].map(e=>e.dataset.insertionPosition),body:shared.textContent,
     options:[...document.querySelectorAll('[data-canonical-number="32"] .solbook-choice-text')].map(e=>e.textContent),answers:document.querySelector('.answer-key-section').textContent,
     underlines:[...shared.querySelectorAll('u')].map(e=>e.textContent)};
   });
   assert.equal(proof.sharedCount,1);assert.deepEqual(proof.positions,['A','B','C','D','E']);assert.deepEqual(proof.options,['(A)','(B)','(C)','(D)','(E)']);
   assert.match(proof.answers,/③/);assert.match(proof.answers,/ⓐ/);assert.match(proof.body,/ⓐ/);assert.match(proof.body,/ⓕ/);assert.deepEqual(proof.underlines,['what','which']);
   await page.screenshot({path:path.join(out,screen+'.png'),fullPage:true});await page.pdf({path:path.join(out,screen+'.pdf'),preferCSSPageSize:true,printBackground:true});
   assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
   fs.writeFileSync(path.join(out,screen+'.json'),JSON.stringify(proof,null,2));
   console.log(`PASS: ${screen} actual PDF/preview ③→(C), original A–E/grammar underlines/answers retained, one shared body, invalid mappings blocked`);
   await page.close();
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
