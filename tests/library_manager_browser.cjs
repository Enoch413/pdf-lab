// Isolated library startup/edit inspection. No Firebase or production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.PDFLAB_NODE_MODULES||'../node_modules','playwright'));
const root=path.resolve(__dirname,'..'),origin='http://library-manager.test',out=path.join(root,'tmp/library-manager-20261120');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000}});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(/firebase.*config/i.test(url.pathname))return route.fulfill({body:'/* isolated */',contentType:'text/javascript'});
   const file=path.resolve(root,decodeURIComponent(url.pathname).slice(1));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/app/index.html?workspace=library');
  await page.waitForFunction(()=>document.body.dataset.dataReady==='true');
  const manager=page.getByRole('heading',{name:'저장된 라이브러리 관리',exact:true});
  await manager.waitFor({state:'visible',timeout:2500});
  await page.evaluate(()=>{
   state.libraryCache.imports=[{sourceId:'qa',fileName:'qa.json',textbookName:'QA',importedAt:1}];
   state.libraryCache.problemRecords=[{kind:'problem',recordId:'qa32',sourceId:'qa',textbookName:'QA',number:32,passageKey:'qa',problemType:'삽입',
    promptText:'주어진 문장을 넣으시오.',answerText:'②',textOnly:true,textStructure:{templateKey:'objective-insertion',questionText:'주어진 문장을 넣으시오.',givenText:'Given sentence.',bodyText:'Opening. ① Next. ② Last.',choices:[]}}];
   renderLibraryWorkspaceDashboard();
   // Reproduce a refresh/import finishing after its busy-state dashboard render.
   setBusy(true);renderLibraryWorkspaceDashboard();
  });
  assert.equal(await manager.count(),0,'review is hidden while busy');
  await page.evaluate(()=>setBusy(false));
  await manager.waitFor({state:'visible',timeout:2500});
  await page.locator('[data-library-stored-range]').fill('32');
  await page.locator('[data-library-stored-range]').press('Tab');
  await page.getByRole('button',{name:'텍스트 수정',exact:true}).click();
  await page.locator('#libraryTextEditorRoot').waitFor({state:'visible'});
  assert.match(await page.locator('#libraryTextEditorTitle').innerText(),/32/);
  await page.screenshot({path:path.join(out,'editor.png')});
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await manager.waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: library manager visible after startup/busy completion, saved question 32 filter/editor, desktop/mobile, no production access');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
