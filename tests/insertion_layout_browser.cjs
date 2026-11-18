// Actual standalone output on an isolated origin; all external requests blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(path.join(process.env.PDFLAB_NODE_MODULES || '../node_modules', 'playwright'));
const root = path.resolve(__dirname, '..'), origin = 'http://insertion-layout.test';
const out = path.join(root, 'tmp/insertion-layout-20261118');
const fixture = JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json'),'utf8'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context = await browser.newContext({viewport:{width:1400,height:1000}});
    let exported = '';
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/output.html')return route.fulfill({body:exported,contentType:'text/html; charset=utf-8'});
      if(/firebase.*config/i.test(url.pathname))return route.fulfill({body:'/* isolated */',contentType:'text/javascript'});
      const file=path.resolve(root,decodeURIComponent(url.pathname).slice(1));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream'});
    });
    for(const screen of ['index','final_test','general_exam']){
      const page=await context.newPage(),errors=[],missing=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('response',r=>{if(r.status()>=400)missing.push(r.url())});
      await page.goto(`${origin}/app/${screen}.html?workspace=exam`);
      await page.waitForFunction(()=>document.body.dataset.appReady==='true');
      exported=await page.evaluate(async fixture=>{
        await PDFLabSolbookText.ready();
        const given='So her father moved the family 200 kilometers away so that she could enter high school.';
        const body='But her hometown had a segregated education system, and black students could not enter high school. ① After graduating from high school, she was admitted to college. ② By her junior year, she had taken all the math courses.';
        const records=[
          {kind:'problem',recordId:'inline',problemType:'삽입',textOnly:true,textStructure:{questionText:'글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',bodyText:`[주어진 문장] ${given} [본문] ${body}`}},
          {kind:'problem',recordId:'separate',problemType:'삽입',textOnly:true,textStructure:{questionText:'주어진 문장을 삽입하시오.',givenText:`[주어진 문장] ${given}`,bodyText:`[본문] ${body}`}}
        ];
        const p=fixture.problems.find(p=>p.problemType==='삽입');
        records.push(PDFLabCanonical.create({...p,givenText:`[주어진 문장] ${given}`,bodyText:`[본문] ${body}`,answerText:'①'},fixture,'test','fixture.json',{kind:'problem',recordId:'canonical',sourceId:'test',textOnly:true}));
        records.push(PDFLabCanonical.create({...p,givenText:'',bodyText:`[주어진 문장] ${given} [본문] ${body}`,answerText:'②'},fixture,'test','fixture.json',{kind:'problem',recordId:'canonical-inline',sourceId:'test',textOnly:true}));
        const before=JSON.stringify(records),settings={...readExamExportSettings(),title:'삽입 문항 출력 검증',contentRenderMode:'text',includeAnswerKey:true,logoSrc:'./assets/code-logo.png'};
        readExamExportSettings=()=>settings;getExamSlotAssignedRecords=()=>records.map(record=>({record}));
        const output=await buildExamPreviewDocument('previewUrls');
        if(JSON.stringify(records)!==before)throw new Error('Output mutated source records');
        return output.html;
      },fixture);
      await page.goto(origin+'/output.html');
      await page.evaluate(()=>document.fonts.ready);
      const geometry=await page.evaluate(()=>Array.from(document.querySelectorAll('.solbook-text-question')).map(card=>{
        const nodes=Array.from((function*(){const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);while(walker.nextNode())yield walker.currentNode})());
        function bounds(needle){const node=nodes.find(n=>n.textContent.includes(needle));if(!node)throw new Error('Missing sentence: '+needle);const range=document.createRange(),start=node.textContent.indexOf(needle);range.setStart(node,start);range.setEnd(node,start+needle.length);return range.getBoundingClientRect().toJSON()}
        const given=bounds('school.'),body=bounds('But her hometown');
        return {text:card.textContent,gap:body.top-given.bottom,lineHeight:parseFloat(getComputedStyle(card.querySelector('.solbook-body')).lineHeight)};
      }));
      assert.equal(geometry.length,4);
      for(const item of geometry){assert(!/\[(?:주어진 문장|본문)\]/.test(item.text));assert(item.gap>=item.lineHeight*.8,JSON.stringify(item));assert(item.text.includes('① After graduating')&&item.text.includes('② By her junior year'))}
      await page.screenshot({path:path.join(out,screen+'.png'),fullPage:true});
      await page.pdf({path:path.join(out,screen+'.pdf'),preferCSSPageSize:true,printBackground:true});
      assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
      fs.writeFileSync(path.join(out,screen+'.json'),JSON.stringify(geometry,null,2));
      console.log(`PASS: ${screen} inline/separate/Canonical insertion, hidden labels, one blank line, positions/answers and source preserved`);
      await page.close();
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
