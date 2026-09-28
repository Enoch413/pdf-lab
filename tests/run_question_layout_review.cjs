// Reproducible local review only. No deployment or production services.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/question-layout-review');fs.mkdirSync(out,{recursive:true});
const sources=['app/index.html','app/final_test.html','app/general_exam.html','app/hanbujang_canonical.js','app/solbook_text_renderer.js','app/problem_page_layout.js','app/pdf_problem_template_repacker.css','app/final_test.css'];
const immutable=['docs/hanbujang-contract/CANONICAL_SCHEMA.json','docs/hanbujang-contract/FIELD_SEMANTICS.md','docs/hanbujang-contract/PROBLEM_TYPE_RULES.md','tests/fixtures/hanbujang/P05_CANONICAL_ACTUAL.json','tests/fixtures/hanbujang/HANBUJANG_SYNTHETIC_7.json','tests/fixtures/hanbujang/derived/R1_BARE_MIXED_INPUT.json','tests/fixtures/hanbujang/derived/R1_BARE_PLAIN_INPUT.json'];
const hashes=files=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const original=hashes(immutable),sourceHashes=hashes(sources),commands=[];
if(process.argv.includes('--resume')){
 const previous=JSON.parse(fs.readFileSync(path.join(out,'FINAL_TEST_RESULTS.json'),'utf8'));
 if(JSON.stringify(previous.sourceHashes)!==JSON.stringify(sourceHashes)||JSON.stringify(previous.immutableHashes)!==JSON.stringify(original))throw Error('Sources changed; run the full review');
 for(const c of previous.commands){if(c.exitCode!==0)break;commands.push(c);}
}
const reusedCommands=commands.length;
const python=process.env.PDFLAB_PYTHON||'python';
for(const [exe,args] of [
 [process.execPath,['tests/run_hanbujang_review.cjs','--r1-final']],
 [process.execPath,['tests/question_page_layout_browser.cjs','--before']],
 [process.execPath,['tests/question_page_layout_browser.cjs']],
 [python,['tests/hanbujang_review_pdf_check.py']],
 [python,['tests/hanbujang_r1_bare_pdf_check.py']],
 [python,['tests/question_page_layout_pdf_check.py']]
].slice(reusedCommands)){
 const start=Date.now(),r=cp.spawnSync(exe,args,{cwd:root,env:process.env,encoding:'utf8',timeout:600000,maxBuffer:20*1024*1024});
 const log=(r.stdout||'')+(r.stderr||'')+(r.error?.stack||''),file=String(commands.length+1)+'-'+path.basename(args[0])+'.log';
 fs.writeFileSync(path.join(out,file),log);commands.push({command:[path.basename(exe),...args].join(' '),exitCode:r.status,durationMs:Date.now()-start,log:file});
 console.log((r.status===0?'PASS ':'FAIL ')+args.join(' '));if(r.status!==0){console.log(log.slice(-4000));break;}
}
const unchanged=JSON.stringify(sourceHashes)===JSON.stringify(hashes(sources))&&JSON.stringify(original)===JSON.stringify(hashes(immutable));
const report={status:commands.length===6&&commands.every(c=>c.exitCode===0)&&unchanged?'PASS':'FAIL',executedAt:new Date().toISOString(),base:'e805a2b51819d095b1c62e5bd620ed62058e4a9b',commands,reusedCommands,sourceHashes,immutableHashes:original,unchangedDuringRun:unchanged,
 notRun:['Production Firebase and user DB','Real teacher PCs/browser profiles','Physical printers','Original PDF semantic extraction audit','Deployment/merge/push']};
fs.writeFileSync(path.join(out,'FINAL_TEST_RESULTS.json'),JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
