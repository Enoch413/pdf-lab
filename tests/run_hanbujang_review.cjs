// Run the existing regressions and canonical user-path QA with the configured local runtime.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const r1Final=process.argv.includes('--r1-final');
const root=path.resolve(__dirname,'..'),out=path.join(root,r1Final?'tmp/hanbujang-r1-final-verification':'tmp/hanbujang-fix-verification');
fs.mkdirSync(out,{recursive:true});
const commands=[];
for(const script of ['hanbujang_contract.test.cjs','solbook_text_renderer.test.cjs','text_pagination_browser.cjs','solbook_text_browser.cjs','json_only_import_browser.cjs','hanbujang_canonical_browser.cjs','hanbujang_review_fixes_browser.cjs',...(r1Final?['hanbujang_r1_bare_browser.cjs']:[])]) {
  const start=Date.now();const run=cp.spawnSync(process.execPath,[path.join('tests',script)],{cwd:root,encoding:'utf8',env:process.env,timeout:300000,maxBuffer:10*1024*1024});
  const log=(run.stdout||'')+(run.stderr||'')+(run.error?run.error.stack:'');
  fs.writeFileSync(path.join(out,script+'.log'),log);
  commands.push({command:'node tests/'+script,result:run.status===0?'PASS':'FAIL',exitCode:run.status,durationMs:Date.now()-start,log:'evidence/'+script+'.log'});
  console.log(commands.at(-1).result+' '+script);
}
const sourceFiles=['app/index.html','app/final_test.html','app/general_exam.html','app/solbook_text_renderer.js','app/hanbujang_canonical.js'];
const details=JSON.parse(fs.readFileSync(path.join(root,'tmp/hanbujang-verification/results.json'),'utf8'));
const fixes=JSON.parse(fs.readFileSync(path.join(root,'tmp/hanbujang-fix-verification/AFTER_BROWSER.json'),'utf8'));
const r1=r1Final?JSON.parse(fs.readFileSync(path.join(out,'R1_BROWSER_RESULTS.json'),'utf8')):null;
const report={status:commands.every(r=>r.result==='PASS')&&details.status==='PASS'&&fixes.status==='PASS'&&(!r1||r1.status==='PASS')?'PASS':'FAIL',executedAt:new Date().toISOString(),
  baseCommit:'44c446ac6cebc36e430e2371c9a47dbfbb356cce',branch:'codex/hanbujang-canonical-16',commands,
  environment:{...details.environment,platform:process.platform,architecture:process.arch,nodeExecutable:process.execPath,
    playwrightVersion:require(path.join(process.env.PDFLAB_NODE_MODULES||path.join(root,'node_modules'),'playwright/package.json')).version},
  sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),
  fixtureHashes:details.fixtureHashes,cases:details.cases,fixCases:fixes.cases,...(r1?{r1Cases:r1.cases,derivedFixtureHashes:r1.fixtureHashes}:{}),
  notRun:['Production Firebase/emulator/real credentials and Security Rules','Real user IndexedDB/browser profile','Physical printer and other teacher computers','Source PDF extraction semantic accuracy audit','7 external skills modification/install','Deployment/push'],
  visualReview:'See implementation report for separately identified rendered PDF pages reviewed by the agent.'};
fs.writeFileSync(path.join(root,r1Final?'PDF_LAB_HANBUJANG_COMPAT_R1_FINAL_TEST_RESULTS.json':'PDF_LAB_HANBUJANG_COMPAT_FIX_TEST_RESULTS.json'),JSON.stringify(report,null,2));
if(report.status!=='PASS')process.exitCode=1;
