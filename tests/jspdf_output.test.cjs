// Actual maker functions + shipped fonts/logo; no browser, Firebase, or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const maker = path.join(root,'dist/solbook_question_maker_portable/app');
const baseline = process.argv.includes('--baseline');
const bundle = baseline ? path.join(root,'tmp/security-hardening-20261020/original-vendor/app/vendor/jspdf/jspdf.umd.min.js') : path.join(root,'app/vendor/jspdf/jspdf.umd.min.js');
const { jsPDF } = require(bundle);
assert.equal(jsPDF.version,baseline?'2.5.2':'4.2.1');
const source=fs.readFileSync(path.join(maker,'solbook_question_maker.html'),'utf8');
const c=vm.createContext({console, Blob, atob, btoa, setTimeout, window:{jspdf:{jsPDF}}});
vm.runInContext(source.slice(source.indexOf('    const CHOICE_MARKERS ='),source.indexOf('    const state =')),c);
vm.runInContext(source.slice(source.indexOf('    const DIRECT_PDF_FONT ='),source.indexOf('    function arrayBufferToBase64(')),c);
vm.runInContext([...source.matchAll(/^    (?:async )?function \w+\([^]*?^    }\r?$/gm)].map(m=>m[0]).join('\n'),c);
for(const file of ['assets/fonts/NotoSansKR-Print.base64.js','assets/code-english-institute-header-logo.base64.js'])vm.runInContext(fs.readFileSync(path.join(maker,file),'utf8'),c);
const cases=[
 ['밑줄어법','We [[u:① learn]] together and [[u:② grow]] steadily.'],
 ['어휘박스','Choose [[box:A:work|play]] and [[box:B:learn|teach]].'],
 ['빈칸','Learning requires [[blank]] and [[blank:A]].'],
 ['삽입','[삽입문]\nThis sentence belongs here.\n[본문]\nFirst. [[s]] Next. [[slot]] Last.'],
 ['순서','[주어진 글]\nOpening.\n(A)\nFirst.\n(B) Second.\n(C) Third.'],
 ['요약','[본문]\nOriginal passage.\n[요약문]\nIt is [[blank:A]] and [[blank:B]].'],
 ['내용일치','Safe <script>text</script> & Unicode 한글 문항.']
];
c.payload=cases.flatMap(([type,body])=>[1,2,3].map(round=>({type,difficulty:'중',stem:`다음 글을 읽고 답하시오. ${round}차`,body,choices:['정답 선택지','다른 선택지','세 번째','네 번째','다섯 번째'],answer:'①',explanation:`한글 해설 ${round}차입니다.`})));
vm.runInContext('var state={questions:normalizeQuestionsFromPayload(payload,"regression.json",0)}; var elements={examTitleInput:{value:"보안 업데이트 한글 회귀"},sortModeSelect:{value:"source"},difficultySelect:{value:""},typeFilterOptions:{querySelectorAll:()=>[...new Set(state.questions.map(q=>q.type))].map(value=>({value}))}};',c);
(async()=>{
  const plans=vm.runInContext('buildBatchExamPlans("source")',c);
  assert.equal(plans.length,3);assert.ok(plans.every(plan=>plan.questions.length===7));
  const out=path.join(root,'tmp/security-hardening-20261020',baseline?'pdf-before':'pdf-after');
  fs.mkdirSync(out,{recursive:true});
  if(!baseline)fs.writeFileSync(path.join(out,'maker-regression.json'),JSON.stringify(c.payload,null,2));
  for(const [index,plan] of plans.entries()){
    c.plan=plan;
    const blob=await vm.runInContext('createDirectPdfBlobForPlan(plan)',c);
    const data=Buffer.from(await blob.arrayBuffer());
    assert.equal(data.subarray(0,5).toString(),'%PDF-');
    fs.writeFileSync(path.join(out,`round-${index+1}.pdf`),data);
  }
  assert.ok(!vm.runInContext('window.jspdf.jsPDF.allowFsRead',c),'Do not opt into filesystem access');
  console.log(`PASS: jsPDF ${jsPDF.version} actual maker 3-round PDFs, Korean fonts, logo, 7 marker/type cases and answers (${out})`);
})().catch(e=>{console.error(e);process.exitCode=1;});
