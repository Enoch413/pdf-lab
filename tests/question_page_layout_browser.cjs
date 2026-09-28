// Real three-screen output in fresh Edge contexts. All external requests blocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require(path.join(process.env.PDFLAB_NODE_MODULES||'../node_modules','playwright'));
const root=path.resolve(__dirname,'..'),before=process.argv.includes('--before');
const out=path.join(root,'tmp/question-layout-review',before?'before':'after');fs.mkdirSync(out,{recursive:true});
const base='e805a2b51819d095b1c62e5bd620ed62058e4a9b',origin='http://question-layout.test';
const p05=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang/P05_CANONICAL_ACTUAL.json'),'utf8'));
const synthetic=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json'),'utf8'));
const result={status:'RUNNING',before,base,cases:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),cache=new Map();let preview='';
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/preview.html')return route.fulfill({body:preview,contentType:'text/html; charset=utf-8'});
   if(/firebase.*config/i.test(u.pathname))return route.fulfill({body:'/* isolated */',contentType:'text/javascript'});
   const rel=decodeURIComponent(u.pathname).slice(1),file=path.resolve(root,rel);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   if(!cache.has(rel)){
    let body=fs.readFileSync(file);
    if(before&&rel.startsWith('app/')){const old=cp.spawnSync('git',['show',base+':'+rel],{cwd:root,maxBuffer:20*1024*1024});if(old.status===0)body=old.stdout;}
    cache.set(rel,body);
   }
   return route.fulfill({body:cache.get(rel),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream'});
  });
  for(const screen of ['index','final_test','general_exam']){
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/app/'+screen+'.html?workspace=exam');await page.waitForFunction(()=>document.body.dataset.appReady==='true');
   const generated=await page.evaluate(async({p05,synthetic,before})=>{
    await PDFLabSolbookText.ready();
    const C=PDFLabCanonical,settings={...readExamExportSettings(),title:'출력 배치 검증',subtitle:'공통지문 · 높이 기반 배치',logoSrc:'',includeAnswerKey:true,contentRenderMode:'text'};
    const width=(SHEET_WIDTH_MM-settings.pagePadding*2-BINDING_MARGIN_MM-settings.columnGap)/2;
    const clone=x=>structuredClone(x),cases=[];
    const record=(p,doc='synth')=>C.create(p,synthetic,doc,doc+'.json',{id:doc+'-'+p.number,recordId:doc+'-'+p.number,sourceId:doc,kind:'problem',textOnly:true,segments:[],segmentImages:[]});
    const basic=(n,lines=1)=>({...clone(synthetic.problems[0]),number:n,questionText:'다음 글의 내용으로 알맞은 것은?',bodyText:('Sentence '+n+' stays readable.\n').repeat(lines),choices:[],answerText:'①',explanationText:'LAYOUT_ANSWER_'+n});
    function sized(n,target){
     let p=basic(n),h=0;
     for(let lines=1;lines<150;lines++){
      p=basic(n,lines);const r=C.textRuntime(record(p),n);
      h=PDFLabSolbookText.measureCard(createProblemCardMarkup({problem:r,fitScale:1,appliedSquashPercent:0}),width);
      if(h>=target)break;
     }
     return p;
    }
    const group=(doc,bodyLines,childLines)=>synthetic.problems.slice(5).map((p,i)=>record({...clone(p),number:i+1,questionGroupId:doc,passageLabel:'[SOURCE-LABEL]',
      bodyText:('Shared reading stays readable.\n').repeat(bodyLines),questionText:('Child '+(i+1)+' asks a question.\n').repeat(childLines),choices:[],explanationText:'GROUP_ANSWER_'+(i+1)},doc));
    async function add(name,records,mode='text',expected={}){
     settings.contentRenderMode=mode;settings.title='출력 배치 검증 · '+name;readExamExportSettings=()=>({...settings});
     getExamSlotAssignedRecords=()=>records.map(record=>({record}));hydrateProblemRecordsWithAssets=async r=>r;
     const snapshot=JSON.stringify(records),payload=await buildExamProblemPayloadFromSlots('previewUrls',{renderContentMode:mode});
     const layout=buildLayoutPages(settings,payload.problems,{repeatHeaderEveryPage:false});
     const rendered=await buildExamPreviewDocument('previewUrls');
     if(snapshot!==JSON.stringify(records))throw Error(name+' mutated records');
     const all=layout.sheets.flatMap(s=>s.columns.flatMap(c=>c.items));
     const text=(html)=>{const d=document.createElement('div');d.innerHTML=html;d.querySelectorAll('[data-repeated-marker],.canonical-group-reference').forEach(e=>e.remove());return d.textContent.replace(/\s+/g,'');};
     for(const p of C.prepareEntries(payload.problems.map(record=>({record}))).map(e=>e.record).filter(isTextRenderProblem)){
      const matching=all.filter(e=>e.problem.id===p.id&&e.problem.kind===p.kind&&e.problem.canonicalDisplay===p.canonicalDisplay);
      if(text(buildProblemTextMarkup(p))!==matching.map(e=>text(buildProblemTextMarkup(e.problem))).join(''))throw Error(name+' lost body/choices/underline text');
     }
     const box=document.createElement('div');box.innerHTML=rendered.markup;
     for(const im of box.querySelectorAll('img[src^="blob:"]')){const blob=await fetch(im.src).then(r=>r.blob());im.src=await new Promise(resolve=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.readAsDataURL(blob);});}
     cases.push({name,html:box.innerHTML,expected,questionCount:rendered.renderedQuestionCount,
       layout:layout.sheets.map(s=>({height:s.columnHeightMm,columns:s.columns.map(c=>({used:c.usedHeightMm,alignEnds:c.alignEnds,items:c.items.map(e=>({number:e.problem.displayNumber,original:e.problem.canonical?.number,group:e.problem.canonical?.questionGroupId||e.problem.groupLabel,kind:e.problem.kind,continuation:!!e.problem.textContinuation,height:e.heightMm,fitScale:e.fitScale,squash:e.appliedSquashPercent,imageSlice:e.problem.imageSlice}))}))})),splitGroups:layout.splitGroups||[]});
    }
    await add('P05-tail',p05.problems.filter(p=>[134,135,141,142].includes(p.number)).map(p=>record(p,'P05')),'text',{groups:2,questions:4});
    await add('synthetic-tail',synthetic.problems.slice(5).map(p=>record(p)),'text',{groups:1,questions:2});
    // Enough for the entire group only when starting on a fresh two-column page.
    await add('page-boundary',[record(sized(9,120),'prefix'),...group('BOUNDARY',32,14)],'text',{groups:1,questions:3,groupNextPage:true});
    await add('long-group',group('LONG',125,23),'text',{groups:1,questions:2,split:true});
    const flexible=group('FLEXIBLE',14,1);flexible[0].canonical.questionText=('Long child sentence.\n').repeat(60);
    await add('long-child-same-page',flexible,'text',{groups:1,questions:2,samePage:true});
    await add('partial-tail',[record(p05.problems.find(p=>p.number===135),'P05')],'text',{groups:1,questions:1,partial:135});
    await add('three-fit',[1,2,3].map(n=>record(sized(n,65),'three')),'text',{columnCount:3});
    await add('third-does-not-fit',[1,2,3].map(n=>record(sized(n,105),'two')),'text',{columnCount:2});
    await add('short-pair',[record(basic(1),'pair'),record(basic(2),'pair')],'text',{columnCount:2});
    await add('long-short',[record(sized(1,180),'ls'),record(basic(2),'ls')],'text',{columnCount:2});
    await add('single',[record(basic(1),'single')],'text',{columnCount:1});
    await add('source-text-kept',[record({...basic(1),questionText:'원문 발문 [17-3]을 읽으시오.',bodyText:'Original source [17-3] and (B) [what / that] stay. [[u:underlined words]]'},'source')],'text',{columnCount:1,sourceText:true});
    await add('long-text',[record({...basic(1,180),questionText:'Keep [[u:underlined words]] and [[blank:A]].'},'long-text')],'text',{longText:true});
    const image=(n,mm)=>{
     const w=600,h=Math.round(600*mm/(width-8));
     const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="white"/><rect x="5" y="5" width="590" height="'+(h-10)+'" fill="none" stroke="black"/>'+Array.from({length:Math.ceil(h/60)},(_,i)=>'<text x="24" y="'+(30+i*60)+'" font-size="20">IMAGE '+n+' ROW '+i+'</text>').join('')+'</svg>';
     return {recordId:'image-'+n,sourceId:'image-source',number:n,kind:'problem',problemType:'내용',groupLabel:'',answerText:'①',explanationText:'Image answer',segmentBlobs:[new Blob([svg],{type:'image/svg+xml'})],segmentMeta:[{x0:0,x1:w,y0:0,y1:h}]};
    };
    await add('images-three',[image(1,48),image(2,48),image(3,48)],'image',{columnCount:3,images:true});
    await add('images-two',[image(1,85),image(2,85),image(3,85)],'image',{columnCount:2,images:true});
    await add('long-image',[image(1,600)],'image',{longImage:true});
    const pack=[{...image(1,115),recordId:'image-shared',number:null,kind:'shared',groupLabel:'IMAGE_GROUP'},... [2,3].map(n=>({...image(n,70),groupLabel:'IMAGE_GROUP'}))];
    await add('image-tail',pack,'image',{groups:1,questions:2,images:true});
    return {html:buildStandaloneHtmlDocument(cases.map(c=>'<div data-qa-case="'+c.name+'">'+c.html+'</div>').join(''),'Output layout QA'),cases:cases.map(({html,...c})=>c)};
   },{p05,synthetic,before});
   preview=generated.html;fs.writeFileSync(path.join(out,screen+'.html'),preview);
   await page.goto(origin+'/preview.html');await page.evaluate(()=>document.fonts.ready);
   await page.emulateMedia({media:'print'});
   const geometry=await page.evaluate(()=>[...document.querySelectorAll('[data-qa-case]')].map(box=>{
    const sheets=[...box.querySelectorAll('.sheet')],columns=[];
    sheets.forEach((sheet,si)=>[...sheet.querySelectorAll('.sheet-column')].forEach((col,ci)=>{
     const r=col.getBoundingClientRect(),sr=sheet.getBoundingClientRect();
     const cards=[...col.querySelectorAll(':scope > .problem-card')].map(card=>{
      const cr=card.getBoundingClientRect(),c=card.querySelector('[data-canonical-number]');
      return {number:card.dataset.questionNumber,original:c?.dataset.canonicalNumber,display:c?.dataset.canonicalDisplay,
       top:cr.top-r.top,bottom:r.bottom-cr.bottom,height:cr.height,visible:card.innerText,scale:getComputedStyle(card).flexShrink};
     });
     columns.push({page:si,column:ci,height:r.height,bottomOnSheet:sr.bottom-r.bottom,cards,align:col.classList.contains('is-two-questions')});
    }));
    return {name:box.dataset.qaCase,columns,pages:sheets.length,instructions:[...box.querySelectorAll('.problem-badge')].filter(e=>e.textContent==='다음 글을 읽고 물음에 답하시오.').length,
     leaked:box.querySelectorAll('.canonical-group-reference').length,text:box.innerText,answers:box.querySelectorAll('.answer-key-answer').length,
     horizontal:[...box.querySelectorAll('.solbook-body,.solbook-stem,.solbook-choice-text')].some(e=>e.scrollWidth>e.clientWidth+2)};
   }));
   if(!before)for(const c of generated.cases){
    const g=geometry.find(g=>g.name===c.name),e=c.expected;
    assert.equal(g.leaked,0);assert(!/NURNTER:|SYN-GROUP|SOURCE-LABEL|IMAGE_GROUP/.test(g.text));assert.equal(g.horizontal,false,c.name);
    assert(!/지문\s*\(계속\)\s*계속/.test(g.text),'duplicate continuation label');
    assert.equal(g.answers,c.questionCount,c.name+' answers');
    for(const col of g.columns){
     assert(col.bottomOnSheet>=8*96/25.4-1,c.name+' bottom page padding');
     col.cards.forEach((card,i)=>{assert(card.bottom>=-1,c.name+' card overflow');assert(card.scale==='0',c.name+' flex shrink');if(i)assert(card.top-(col.cards[i-1].top+col.cards[i-1].height)>=3*96/25.4-1,c.name+' minimum gap');});
     if(col.cards.length){assert(Math.abs(col.cards[0].top)<1,c.name+' top');if(col.align)assert(Math.abs(col.cards.at(-1).bottom)<1,c.name+' bottom');}
    }
    if(e.groups){assert.equal(g.instructions,e.groups,c.name+' heading once');assert.equal(c.questionCount,e.questions);}
    if(e.columnCount){assert.equal(g.columns[0].cards.length,e.columnCount,c.name);if(e.columnCount===2)assert(g.columns[0].align,c.name);}
    if(e.groupNextPage){const pages=g.columns.filter(col=>col.cards.some(card=>card.display==='shared'||card.original==='1'||card.original==='2')).map(col=>col.page);assert(pages.every(p=>p===1),c.name+' whole group next page');}
    if(e.split){assert(c.splitGroups.length);assert(g.pages>1);assert(g.text.includes('계속'));}
    if(e.samePage){assert.equal(g.pages,1,c.name);assert.equal(c.splitGroups.length,0,c.name);}
    if(e.partial)assert.deepEqual(g.columns.flatMap(col=>col.cards).filter(card=>card.display==='child').map(card=>Number(card.original)),[e.partial]);
    if(e.sourceText){assert(g.text.includes('원문 발문 [17-3]'));assert(g.text.includes('Original source [17-3] and (B) [what / that] stay.'));assert(g.text.includes('underlined words'));}
    if(e.longText||e.longImage)assert(c.layout.flatMap(s=>s.columns.flatMap(c=>c.items)).length>1);
    if(e.longImage){const slices=c.layout.flatMap(s=>s.columns.flatMap(c=>c.items));assert(slices.every(e=>e.fitScale===1&&e.squash===0&&e.imageSlice));for(let i=1;i<slices.length;i++)assert(Math.abs(slices[i].imageSlice.offsetMm-slices[i-1].imageSlice.offsetMm-slices[i-1].imageSlice.heightMm)<0.01);}
    if(c.name==='P05-tail')for(const ns of [[134,135],[141,142]]){const pages=g.columns.filter(col=>col.cards.some(card=>ns.includes(Number(card.original)))).map(col=>col.page);assert.equal(new Set(pages).size,1,'P05 group same page');}
   }
   assert.deepEqual(errors,[]);
   await page.pdf({path:path.join(out,screen+'.pdf'),preferCSSPageSize:true,printBackground:true});
   result.cases.push({screen,cases:generated.cases,geometry});console.log('PASS '+screen+' '+(before?'baseline capture':generated.cases.length+' layout scenarios, content and geometry'));
   await page.close();
  }
  result.status=before?'BASELINE_CAPTURED':'PASS';
 }finally{await browser.close();}
})().catch(e=>{result.status='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(out,'RESULTS.json'),JSON.stringify(result,null,2)));
